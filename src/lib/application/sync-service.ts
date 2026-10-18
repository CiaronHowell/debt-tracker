import type { DebtTrackerDatabase } from '$lib/persistence/db';
import {
  IndexedDbDevicePassphraseStore,
  type DevicePassphraseStore
} from '$lib/persistence/device-passphrase';
import {
  conflictResultSchema,
  LOGOUT_API_PATH,
  pushResultSchema,
  remoteStateSchema,
  SESSION_API_PATH,
  sessionResultSchema,
  SYNC_API_PATH,
  type RemoteState,
  type SessionResult
} from '$lib/sync/protocol';
import { BackupService, type BackupPreview } from './backup-service';
import { AppError } from './errors';
import { decideSync } from './sync-decision';

export const SYNC_STATE_STORAGE_KEY = 'debt-tracker:sync';
const MAX_PUSH_ATTEMPTS = 3;

/** Device-local sync bookkeeping. Kept out of IndexedDB so it never enters backups. */
export interface SyncState {
  baseRevision: number | null;
  syncedWriteAt: string | null;
}

export interface SyncDependencies {
  fetch: typeof globalThis.fetch;
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  /** Where "Remember this device" keeps the passphrase between reloads. */
  passphraseStore: DevicePassphraseStore;
}

export interface SyncConflict {
  remoteRevision: number;
  remoteUpdatedAt: string | null;
  remote: BackupPreview['counts'];
  local: BackupPreview['counts'];
}

export type SyncOutcome =
  | { action: 'noop' | 'push' | 'pull'; revision: number }
  | { action: 'conflict'; conflict: SyncConflict };

export type ConflictChoice = 'keep-device' | 'use-cloud';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class SyncService {
  private readonly backups: BackupService;
  private readonly dependencies: SyncDependencies;
  private passphrase: string | null = null;

  constructor(
    private readonly database: DebtTrackerDatabase,
    dependencies: Partial<SyncDependencies> = {}
  ) {
    this.backups = new BackupService(database);
    this.dependencies = {
      fetch: dependencies.fetch ?? ((...args) => globalThis.fetch(...args)),
      storage: dependencies.storage ?? globalThis.localStorage,
      passphraseStore: dependencies.passphraseStore ?? new IndexedDbDevicePassphraseStore()
    };
  }

  isEnabled(): boolean {
    return this.readState() !== null;
  }

  isUnlocked(): boolean {
    return this.passphrase !== null;
  }

  canRemember(): boolean {
    return this.dependencies.passphraseStore.isAvailable();
  }

  getState(): SyncState | null {
    return this.readState();
  }

  /** Marks this device as syncing. Idempotent; keeps any existing revision bookkeeping. */
  enable(): void {
    if (!this.readState()) this.writeState({ baseRevision: null, syncedWriteAt: null });
  }

  async disable(): Promise<void> {
    this.passphrase = null;
    this.dependencies.storage.removeItem(SYNC_STATE_STORAGE_KEY);
    await this.dependencies.passphraseStore.clear();
  }

  /** Drops the passphrase from memory and forgets it if this device remembered it. */
  async lock(): Promise<void> {
    this.passphrase = null;
    await this.dependencies.passphraseStore.clear();
  }

  /** Unlocks with a passphrase remembered on this device. Returns whether it did. */
  async resume(): Promise<boolean> {
    if (this.passphrase !== null || !this.isEnabled()) return false;
    const passphrase = await this.dependencies.passphraseStore.load();
    if (passphrase === null) return false;
    this.passphrase = passphrase;
    return true;
  }

  async getSession(): Promise<SessionResult> {
    const response = await this.request(SESSION_API_PATH);
    return sessionResultSchema.parse(await response.json());
  }

  async signOut(): Promise<void> {
    try {
      await this.request(LOGOUT_API_PATH, { method: 'POST', body: '{}' });
    } finally {
      await this.disable();
    }
  }

  async getRemoteRevision(): Promise<number> {
    return (await this.fetchRemote(true)).revision;
  }

  /** Returns whether the cloud already holds data (i.e. the passphrase was verified against it). */
  async unlock(
    passphrase: string,
    { remember = false }: { remember?: boolean } = {}
  ): Promise<{ remoteExists: boolean }> {
    const remote = await this.fetchRemote(false);
    if (remote.envelope) {
      try {
        await this.backups.preview(remote.envelope, passphrase);
      } catch (error) {
        throw new AppError(
          'SYNC_PASSPHRASE_INVALID',
          'That passphrase could not decrypt your cloud data.',
          {},
          error
        );
      }
    }
    try {
      if (remember) await this.dependencies.passphraseStore.save(passphrase);
      else await this.dependencies.passphraseStore.clear();
    } catch (error) {
      throw new AppError(
        'PERSISTENCE_WRITE_FAILED',
        'This device could not remember your passphrase. Try again without remembering it.',
        {},
        error
      );
    }
    this.passphrase = passphrase;
    return { remoteExists: remote.envelope !== null };
  }

  async sync(): Promise<SyncOutcome> {
    const passphrase = this.requirePassphrase();

    for (let attempt = 0; attempt < MAX_PUSH_ATTEMPTS; attempt += 1) {
      const state = this.readState() ?? { baseRevision: null, syncedWriteAt: null };
      const remote = await this.fetchRemote(true);
      const writeAt = await this.lastWriteAt();
      const localEmpty = await this.isLocalEmpty();
      const action = decideSync({
        baseRevision: state.baseRevision,
        remoteRevision: remote.revision,
        localDirty: state.syncedWriteAt === null ? !localEmpty : writeAt !== state.syncedWriteAt,
        localEmpty
      });

      if (action === 'noop') return { action, revision: remote.revision };
      if (action === 'pull') return { action, revision: await this.pull(passphrase) };
      if (action === 'conflict') {
        return { action, conflict: await this.describeConflict(passphrase) };
      }

      const pushed = await this.push(passphrase, remote.revision);
      if (pushed !== null) return { action: 'push', revision: pushed };
      // Another device won the race for this revision; re-evaluate against the new head.
    }

    throw new AppError('SYNC_CONFLICT', 'The cloud copy kept changing. Try syncing again.');
  }

  async resolveConflict(choice: ConflictChoice): Promise<number> {
    const passphrase = this.requirePassphrase();
    if (choice === 'use-cloud') return this.pull(passphrase);

    const remote = await this.fetchRemote(true);
    const pushed = await this.push(passphrase, remote.revision);
    if (pushed === null) {
      throw new AppError('SYNC_CONFLICT', 'The cloud copy changed again. Review it and retry.');
    }
    return pushed;
  }

  private requirePassphrase(): string {
    if (this.passphrase === null) {
      throw new AppError('SYNC_LOCKED', 'Enter your sync passphrase to continue.');
    }
    return this.passphrase;
  }

  /** Returns the new revision, or null if the remote moved past `baseRevision`. */
  private async push(passphrase: string, baseRevision: number): Promise<number | null> {
    // Capture before exporting: a write that lands mid-export will still mark the device dirty.
    const writeAt = await this.lastWriteAt();
    const envelope = await this.backups.exportEncryptedSnapshot(passphrase);
    const response = await this.request(
      SYNC_API_PATH,
      { method: 'PUT', body: JSON.stringify({ baseRevision, envelope }) },
      [409]
    );
    if (response.status === 409) {
      conflictResultSchema.parse(await response.json());
      return null;
    }
    const result = pushResultSchema.parse(await response.json());
    this.writeState({ baseRevision: result.revision, syncedWriteAt: writeAt });
    return result.revision;
  }

  private async pull(passphrase: string): Promise<number> {
    const remote = await this.fetchRemote(false);
    if (!remote.envelope) return remote.revision;
    const envelope = remote.envelope;
    await this.decryptRemote(() => this.backups.importBackup(envelope, passphrase));
    this.writeState({ baseRevision: remote.revision, syncedWriteAt: await this.lastWriteAt() });
    return remote.revision;
  }

  private async describeConflict(passphrase: string): Promise<SyncConflict> {
    const remote = await this.fetchRemote(false);
    const envelope = remote.envelope;
    const preview = envelope
      ? await this.decryptRemote(() => this.backups.preview(envelope, passphrase))
      : null;
    const [debts, scenarios, payments, payLaterPlans, payLaterPayments, balanceSnapshots] =
      await Promise.all([
        this.database.debts.count(),
        this.database.scenarios.count(),
        this.database.payments.count(),
        this.database.payLaterPlans.count(),
        this.database.payLaterPayments.count(),
        this.database.balanceSnapshots.count()
      ]);
    return {
      remoteRevision: remote.revision,
      remoteUpdatedAt: remote.updatedAt,
      remote: preview?.counts ?? {
        debts: 0,
        scenarios: 0,
        payments: 0,
        payLaterPlans: 0,
        payLaterPayments: 0,
        balanceSnapshots: 0
      },
      local: { debts, scenarios, payments, payLaterPlans, payLaterPayments, balanceSnapshots }
    };
  }

  /**
   * A passphrase verified earlier (or remembered) stops working if another device re-seeded an
   * emptied cloud with a different one. Lock instead of retrying it on every sync.
   */
  private async decryptRemote<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (!(error instanceof AppError) || error.code !== 'IMPORT_DECRYPTION_FAILED') throw error;
      await this.lock();
      throw new AppError(
        'SYNC_PASSPHRASE_INVALID',
        'Your passphrase no longer decrypts the cloud copy. Enter it again.',
        {},
        error
      );
    }
  }

  private async fetchRemote(metaOnly: boolean): Promise<RemoteState> {
    const response = await this.request(metaOnly ? `${SYNC_API_PATH}?meta=1` : SYNC_API_PATH);
    return remoteStateSchema.parse(await response.json());
  }

  private async lastWriteAt(): Promise<string | null> {
    const meta = await this.database.appMeta.get('last-successful-write-at');
    return typeof meta?.value === 'string' ? meta.value : null;
  }

  private async isLocalEmpty(): Promise<boolean> {
    const [debts, settings, payLaterPlans] = await Promise.all([
      this.database.debts.count(),
      this.database.planSettings.count(),
      this.database.payLaterPlans.count()
    ]);
    return debts === 0 && settings === 0 && payLaterPlans === 0;
  }

  private async request(
    path: string,
    init: RequestInit = {},
    allowedStatuses: number[] = []
  ): Promise<Response> {
    let response: Response;
    try {
      response = await this.dependencies.fetch(path, {
        ...init,
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', accept: 'application/json' }
      });
    } catch (error) {
      throw new AppError('SYNC_NETWORK', 'The sync service could not be reached.', {}, error);
    }
    if (response.ok || allowedStatuses.includes(response.status)) return response;
    if (response.status === 401 || response.status === 403) {
      throw new AppError('SYNC_UNAUTHORIZED', 'Sign in again to keep syncing.', {
        status: response.status
      });
    }
    throw new AppError('SYNC_NETWORK', 'The sync service returned an error.', {
      status: response.status
    });
  }

  private readState(): SyncState | null {
    const raw = this.dependencies.storage.getItem(SYNC_STATE_STORAGE_KEY);
    if (!raw) return null;
    try {
      const value: unknown = JSON.parse(raw);
      if (!isRecord(value)) return null;
      const { baseRevision, syncedWriteAt } = value;
      return {
        baseRevision: typeof baseRevision === 'number' ? baseRevision : null,
        syncedWriteAt: typeof syncedWriteAt === 'string' ? syncedWriteAt : null
      };
    } catch {
      return null;
    }
  }

  private writeState(state: SyncState): void {
    this.dependencies.storage.setItem(SYNC_STATE_STORAGE_KEY, JSON.stringify(state));
  }
}
