import {
  AppError,
  SyncService,
  type ConflictChoice,
  type SyncConflict,
  type SyncOutcome
} from '$lib/application';
import { getDatabase, PERSISTENCE_WRITE_SUCCESS_EVENT } from '$lib/persistence';

export type SyncStatus =
  'disabled' | 'locked' | 'syncing' | 'synced' | 'conflict' | 'offline' | 'error' | 'signed-out';

const WRITE_DEBOUNCE_MS = 2_000;

/**
 * App-wide owner sync state. Inert unless this device opted in on /account, so
 * public visitors never make a request to the sync API.
 */
class SyncController {
  status = $state<SyncStatus>('disabled');
  message = $state('');
  lastSyncedAt = $state<string | null>(null);
  conflict = $state<SyncConflict | null>(null);
  /** Set when a background pull replaced local data the current page may have rendered. */
  remoteChangesApplied = $state(false);
  unlocked = $state(false);
  /** Whether this device keeps the passphrase between reloads. */
  remembered = $state(false);

  private service: SyncService | undefined;
  private listening = false;
  private resuming: Promise<void> | null = null;
  private running: Promise<void> | null = null;
  private rerun = false;
  private debounce: ReturnType<typeof setTimeout> | undefined;

  get sync(): SyncService {
    this.service ??= new SyncService(getDatabase());
    return this.service;
  }

  get enabled(): boolean {
    return this.status !== 'disabled';
  }

  get canRemember(): boolean {
    return this.sync.canRemember();
  }

  start(): void {
    if (typeof window === 'undefined' || !this.sync.isEnabled()) {
      this.status = 'disabled';
      return;
    }
    if (!this.sync.isUnlocked()) this.status = 'locked';
    this.resuming ??= this.resume();
    if (this.listening) return;
    this.listening = true;
    window.addEventListener(PERSISTENCE_WRITE_SUCCESS_EVENT, () => this.schedule());
    window.addEventListener('focus', () => this.schedule(0));
    window.addEventListener('online', () => this.schedule(0));
  }

  enable(): void {
    this.sync.enable();
    this.start();
  }

  /** Resolves once a remembered passphrase, if any, has unlocked sync (before it syncs). */
  ready(): Promise<void> {
    return this.resuming ?? Promise.resolve();
  }

  async unlock(passphrase: string, remember = false): Promise<{ remoteExists: boolean }> {
    const result = await this.sync.unlock(passphrase, { remember });
    this.unlocked = true;
    this.remembered = remember;
    this.status = 'syncing';
    await this.syncNow({ background: false });
    return result;
  }

  async lock(): Promise<void> {
    await this.sync.lock();
    this.unlocked = false;
    this.remembered = false;
    if (this.status !== 'disabled') this.status = 'locked';
  }

  async syncNow({ background = true }: { background?: boolean } = {}): Promise<void> {
    if (!this.sync.isUnlocked() || this.status === 'conflict') return;
    if (this.running) {
      this.rerun = true;
      return this.running;
    }
    this.running = this.run(() => this.sync.sync(), background);
    try {
      await this.running;
    } finally {
      this.running = null;
    }
    if (this.rerun) {
      this.rerun = false;
      await this.syncNow({ background });
    }
  }

  async resolveConflict(choice: ConflictChoice): Promise<void> {
    this.status = 'syncing';
    this.running = this.run(async () => {
      const revision = await this.sync.resolveConflict(choice);
      return { action: choice === 'use-cloud' ? 'pull' : 'push', revision } as SyncOutcome;
    }, false);
    try {
      await this.running;
    } finally {
      this.running = null;
    }
  }

  async signOut(): Promise<void> {
    clearTimeout(this.debounce);
    try {
      await this.sync.signOut();
    } finally {
      this.unlocked = false;
      this.remembered = false;
      this.status = 'disabled';
      this.conflict = null;
      this.lastSyncedAt = null;
      this.message = '';
    }
  }

  /** Bumped to re-mount the current page so it reloads data pulled from the cloud. */
  viewVersion = $state(0);

  refreshView(): void {
    this.remoteChangesApplied = false;
    this.viewVersion += 1;
  }

  private async resume(): Promise<void> {
    try {
      if (!(await this.sync.resume())) return;
    } catch {
      return; // An unreadable remembered passphrase just leaves sync locked.
    }
    this.unlocked = true;
    this.remembered = true;
    void this.syncNow();
  }

  private schedule(delay = WRITE_DEBOUNCE_MS): void {
    if (!this.sync.isUnlocked()) return;
    clearTimeout(this.debounce);
    this.debounce = setTimeout(() => void this.syncNow(), delay);
  }

  private async run(action: () => Promise<SyncOutcome>, background: boolean): Promise<void> {
    this.status = 'syncing';
    this.message = '';
    try {
      const outcome = await action();
      if (outcome.action === 'conflict') {
        this.conflict = outcome.conflict;
        this.status = 'conflict';
        return;
      }
      this.conflict = null;
      if (outcome.action === 'pull' && background) this.remoteChangesApplied = true;
      this.lastSyncedAt = new Date().toISOString();
      this.status = 'synced';
    } catch (error) {
      this.applyError(error);
    }
  }

  private applyError(error: unknown): void {
    this.message = error instanceof Error ? error.message : 'Sync failed.';
    if (!(error instanceof AppError)) {
      this.status = 'error';
      return;
    }
    switch (error.code) {
      case 'SYNC_UNAUTHORIZED':
        this.status = 'signed-out';
        break;
      case 'SYNC_LOCKED':
        this.status = 'locked';
        break;
      case 'SYNC_PASSPHRASE_INVALID':
        this.unlocked = false;
        this.remembered = false;
        this.status = 'locked';
        break;
      case 'SYNC_NETWORK':
        this.status = navigator.onLine ? 'error' : 'offline';
        break;
      default:
        this.status = 'error';
    }
  }
}

export const syncController = new SyncController();
