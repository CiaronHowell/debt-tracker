import type { Table } from 'dexie';
import type { DebtTrackerDatabase } from '$lib/persistence/db';
import type {
  BackupEnvelope,
  BackupPayload,
  EncryptedBackupEnvelope,
  PlainBackupEnvelope
} from '$lib/persistence/models';
import {
  encryptedBackupEnvelopeSchema,
  parseAppMeta,
  parseBackupPayload,
  parsePlainBackupEnvelope
} from '$lib/persistence/schemas';
import { AppError, persistenceWriteError } from './errors';
import { calculateScenarioProjection } from './plan-service';
import { resolveDependencies, type ServiceDependencies } from './service-utils';

const BACKUP_VERSION = 1;
const PBKDF2_ITERATIONS = 600_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const INTERNAL_ROLLBACK_KEY = 'internal-import-rollback';
const ALLOWED_META_KEYS = new Set([
  'schema-version',
  'last-export-at',
  'last-successful-write-at',
  'dismissed-notices'
]);

export interface BackupPreview {
  encrypted: boolean;
  exportedAt: string;
  counts: {
    debts: number;
    scenarios: number;
    payments: number;
    balanceSnapshots: number;
  };
}

export interface ImportResult extends BackupPreview {
  activeScenarioId: string | null;
}

interface DecodedBackup {
  envelope: PlainBackupEnvelope;
  encrypted: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function deriveEncryptionKey(
  passphrase: string,
  salt: Uint8Array<ArrayBuffer>,
  usages: KeyUsage[]
): Promise<CryptoKey> {
  const material = await globalThis.crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return globalThis.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt,
      iterations: PBKDF2_ITERATIONS
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    usages
  );
}

function validatePassphrase(passphrase: string | undefined): string {
  if (!passphrase || passphrase.length > 1_024) {
    throw new AppError(
      'VALIDATION_FAILED',
      'Enter a backup passphrase between 1 and 1,024 characters.'
    );
  }
  return passphrase;
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    throw new AppError('IMPORT_INVALID', 'The selected file is not valid backup JSON.', {}, error);
  }
}

function parseEnvelopeCandidate(value: unknown): BackupEnvelope {
  if (!isRecord(value) || typeof value.format !== 'string') {
    throw new AppError('IMPORT_INVALID', 'The selected file is not a Debt Tracker backup.');
  }
  if (value.version !== BACKUP_VERSION) {
    throw new AppError(
      'IMPORT_UNSUPPORTED_VERSION',
      'This backup version is not supported by this version of Debt Tracker.',
      { version: typeof value.version === 'number' ? value.version : null }
    );
  }

  try {
    if (value.format === 'debt-tracker-backup') return parsePlainBackupEnvelope(value);
    if (value.format === 'debt-tracker-backup-encrypted') {
      return encryptedBackupEnvelopeSchema.parse(value) as EncryptedBackupEnvelope;
    }
  } catch (error) {
    throw new AppError('IMPORT_INVALID', 'The backup structure or fields are invalid.', {}, error);
  }

  throw new AppError('IMPORT_INVALID', 'The selected file uses an unknown backup format.');
}

function assertUnique(values: string[], label: string): void {
  if (new Set(values).size !== values.length) {
    throw new AppError('IMPORT_INVALID', `The backup contains duplicate ${label} identifiers.`);
  }
}

function validatePayloadRelations(input: unknown): BackupPayload {
  let payload: BackupPayload;
  try {
    payload = parseBackupPayload(input);
  } catch (error) {
    throw new AppError('IMPORT_INVALID', 'The backup data failed strict validation.', {}, error);
  }

  assertUnique(
    payload.debts.map((item) => item.id),
    'debt'
  );
  assertUnique(
    payload.scenarios.map((item) => item.id),
    'scenario'
  );
  assertUnique(
    payload.payments.map((item) => item.id),
    'payment'
  );
  assertUnique(
    payload.balanceSnapshots.map((item) => item.id),
    'balance snapshot'
  );
  assertUnique(
    payload.appMeta.map((item) => item.key),
    'metadata'
  );

  if (payload.planSettings.length > 1) {
    throw new AppError('IMPORT_INVALID', 'The backup contains multiple primary plan settings.');
  }
  if (payload.appMeta.some((item) => !ALLOWED_META_KEYS.has(item.key))) {
    throw new AppError('IMPORT_INVALID', 'The backup contains unsupported application metadata.');
  }

  const debtIds = new Set(payload.debts.map((debt) => debt.id));
  const scenarioIds = new Set(payload.scenarios.map((scenario) => scenario.id));
  for (const payment of payload.payments) {
    if (!debtIds.has(payment.debtId)) {
      throw new AppError('IMPORT_INVALID', 'A payment references a missing debt.');
    }
  }
  for (const snapshot of payload.balanceSnapshots) {
    if (!debtIds.has(snapshot.debtId)) {
      throw new AppError('IMPORT_INVALID', 'A balance snapshot references a missing debt.');
    }
  }
  for (const scenario of payload.scenarios) {
    assertUnique(
      scenario.debtSnapshot.map((debt) => debt.debtId),
      `debt snapshot in scenario ${scenario.id}`
    );
    if (scenario.sourceScenarioId && !scenarioIds.has(scenario.sourceScenarioId)) {
      throw new AppError('IMPORT_INVALID', 'A scenario references a missing source scenario.');
    }
    if (scenario.debtSnapshot.some((debt) => !debtIds.has(debt.debtId))) {
      throw new AppError('IMPORT_INVALID', 'A scenario snapshot references a missing debt.');
    }
  }

  const settings = payload.planSettings[0];
  if (settings?.activeScenarioId && !scenarioIds.has(settings.activeScenarioId)) {
    throw new AppError('IMPORT_INVALID', 'The active plan references a missing scenario.');
  }
  if (settings?.setupCompletedAt && !settings.activeScenarioId) {
    throw new AppError('IMPORT_INVALID', 'Completed setup is missing an active scenario.');
  }
  if (settings?.activeScenarioId) {
    const active = payload.scenarios.find((scenario) => scenario.id === settings.activeScenarioId);
    if (!active) throw new AppError('IMPORT_INVALID', 'The active scenario is missing.');
    try {
      calculateScenarioProjection(settings, active);
    } catch (error) {
      throw new AppError('IMPORT_INVALID', 'The active plan in the backup is invalid.', {}, error);
    }
  }

  return payload;
}

function previewFor(decoded: DecodedBackup): BackupPreview {
  const payload = decoded.envelope.payload;
  return {
    encrypted: decoded.encrypted,
    exportedAt: decoded.envelope.exportedAt,
    counts: {
      debts: payload.debts.length,
      scenarios: payload.scenarios.length,
      payments: payload.payments.length,
      balanceSnapshots: payload.balanceSnapshots.length
    }
  };
}

export class BackupService {
  private readonly dependencies: ServiceDependencies;
  private readonly allTables: Table[];

  constructor(
    private readonly database: DebtTrackerDatabase,
    dependencies: Partial<ServiceDependencies> = {}
  ) {
    this.dependencies = resolveDependencies(dependencies);
    this.allTables = [
      database.debts,
      database.planSettings,
      database.scenarios,
      database.payments,
      database.balanceSnapshots,
      database.appMeta
    ];
  }

  private async readPayload(): Promise<BackupPayload> {
    const [debts, planSettings, scenarios, payments, balanceSnapshots, appMeta] = await Promise.all(
      [
        this.database.debts.toArray(),
        this.database.planSettings.toArray(),
        this.database.scenarios.toArray(),
        this.database.payments.toArray(),
        this.database.balanceSnapshots.toArray(),
        this.database.appMeta.toArray()
      ]
    );
    return parseBackupPayload({
      debts,
      planSettings,
      scenarios,
      payments,
      balanceSnapshots,
      appMeta: appMeta.filter((item) => item.key !== INTERNAL_ROLLBACK_KEY)
    });
  }

  async exportPlain(): Promise<PlainBackupEnvelope> {
    try {
      return await this.database.transaction('rw', this.allTables, async () => {
        const exportedAt = this.dependencies.now();
        await this.database.appMeta.bulkPut([
          parseAppMeta({ key: 'last-export-at', value: exportedAt, updatedAt: exportedAt }),
          parseAppMeta({
            key: 'last-successful-write-at',
            value: exportedAt,
            updatedAt: exportedAt
          })
        ]);
        const payload = validatePayloadRelations(await this.readPayload());
        return parsePlainBackupEnvelope({
          format: 'debt-tracker-backup',
          version: BACKUP_VERSION,
          exportedAt,
          payload
        });
      });
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('EXPORT_FAILED', 'The backup could not be created. Try again.', {}, error);
    }
  }

  async exportEncrypted(passphrase: string): Promise<EncryptedBackupEnvelope> {
    const validPassphrase = validatePassphrase(passphrase);
    const plain = await this.exportPlain();

    try {
      const salt = globalThis.crypto.getRandomValues(new Uint8Array(SALT_BYTES));
      const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_BYTES));
      const key = await deriveEncryptionKey(validPassphrase, salt, ['encrypt']);
      const plaintext = new TextEncoder().encode(JSON.stringify(plain));
      const ciphertext = await globalThis.crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        key,
        plaintext
      );
      return {
        format: 'debt-tracker-backup-encrypted',
        version: BACKUP_VERSION,
        exportedAt: plain.exportedAt,
        encryption: {
          algorithm: 'AES-256-GCM',
          keyDerivation: 'PBKDF2-HMAC-SHA-256',
          iterations: PBKDF2_ITERATIONS,
          salt: encodeBase64(salt),
          iv: encodeBase64(iv)
        },
        ciphertext: encodeBase64(new Uint8Array(ciphertext))
      };
    } catch (error) {
      throw new AppError('EXPORT_FAILED', 'The encrypted backup could not be created.', {}, error);
    }
  }

  serialize(envelope: BackupEnvelope): string {
    return JSON.stringify(envelope, null, 2);
  }

  private async decode(input: string | unknown, passphrase?: string): Promise<DecodedBackup> {
    const candidate = parseEnvelopeCandidate(typeof input === 'string' ? parseJson(input) : input);
    if (candidate.format === 'debt-tracker-backup') {
      const payload = validatePayloadRelations(candidate.payload);
      return { envelope: { ...candidate, payload }, encrypted: false };
    }

    const validPassphrase = validatePassphrase(passphrase);
    let plaintext: string;
    try {
      const salt = decodeBase64(candidate.encryption.salt);
      const iv = decodeBase64(candidate.encryption.iv);
      if (salt.byteLength !== SALT_BYTES || iv.byteLength !== IV_BYTES)
        throw new Error('Invalid IV.');
      const key = await deriveEncryptionKey(validPassphrase, salt, ['decrypt']);
      const decrypted = await globalThis.crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        key,
        decodeBase64(candidate.ciphertext)
      );
      plaintext = new TextDecoder('utf-8', { fatal: true }).decode(decrypted);
    } catch (error) {
      throw new AppError(
        'IMPORT_DECRYPTION_FAILED',
        'The backup could not be decrypted. Check the passphrase and file.',
        {},
        error
      );
    }

    const decryptedEnvelope = parseEnvelopeCandidate(parseJson(plaintext));
    if (decryptedEnvelope.format !== 'debt-tracker-backup') {
      throw new AppError('IMPORT_INVALID', 'The encrypted file does not contain a plain backup.');
    }
    if (decryptedEnvelope.exportedAt !== candidate.exportedAt) {
      throw new AppError('IMPORT_INVALID', 'The encrypted backup metadata does not match.');
    }
    const payload = validatePayloadRelations(decryptedEnvelope.payload);
    return { envelope: { ...decryptedEnvelope, payload }, encrypted: true };
  }

  async preview(input: string | unknown, passphrase?: string): Promise<BackupPreview> {
    return previewFor(await this.decode(input, passphrase));
  }

  private async clearAndInsert(payload: BackupPayload, rollback?: BackupPayload): Promise<void> {
    await Promise.all([
      this.database.debts.clear(),
      this.database.planSettings.clear(),
      this.database.scenarios.clear(),
      this.database.payments.clear(),
      this.database.balanceSnapshots.clear(),
      this.database.appMeta.clear()
    ]);
    await Promise.all([
      payload.debts.length ? this.database.debts.bulkAdd(payload.debts) : Promise.resolve(),
      payload.planSettings.length
        ? this.database.planSettings.bulkAdd(payload.planSettings)
        : Promise.resolve(),
      payload.scenarios.length
        ? this.database.scenarios.bulkAdd(payload.scenarios)
        : Promise.resolve(),
      payload.payments.length
        ? this.database.payments.bulkAdd(payload.payments)
        : Promise.resolve(),
      payload.balanceSnapshots.length
        ? this.database.balanceSnapshots.bulkAdd(payload.balanceSnapshots)
        : Promise.resolve(),
      payload.appMeta.length ? this.database.appMeta.bulkAdd(payload.appMeta) : Promise.resolve()
    ]);
    if (rollback) {
      const now = this.dependencies.now();
      await this.database.appMeta.put(
        parseAppMeta({ key: INTERNAL_ROLLBACK_KEY, value: rollback, updatedAt: now })
      );
      await this.database.appMeta.put(
        parseAppMeta({ key: 'last-successful-write-at', value: now, updatedAt: now })
      );
    }
  }

  private async restore(payload: BackupPayload): Promise<void> {
    await this.database.transaction('rw', this.allTables, () => this.clearAndInsert(payload));
  }

  private async verifyStoredState(): Promise<BackupPayload> {
    return this.database.transaction('r', this.allTables, async () =>
      validatePayloadRelations(await this.readPayload())
    );
  }

  async importBackup(input: string | unknown, passphrase?: string): Promise<ImportResult> {
    const decoded = await this.decode(input, passphrase);
    const incoming = decoded.envelope.payload;
    let rollback: BackupPayload | undefined;

    try {
      rollback = await this.database.transaction('r', this.allTables, () => this.readPayload());
      await this.database.transaction('rw', this.allTables, () =>
        this.clearAndInsert(incoming, rollback)
      );
      await this.verifyStoredState();
      await this.database.transaction('rw', this.database.appMeta, () =>
        this.database.appMeta.delete(INTERNAL_ROLLBACK_KEY)
      );
    } catch (error) {
      if (typeof rollback !== 'undefined') {
        try {
          await this.restore(rollback);
        } catch (restoreError) {
          throw persistenceWriteError(restoreError);
        }
      }
      if (error instanceof AppError) throw error;
      throw persistenceWriteError(error);
    }

    const settings = incoming.planSettings[0];
    return {
      ...previewFor(decoded),
      activeScenarioId: settings?.activeScenarioId ?? null
    };
  }

  async recoverInterruptedImport(): Promise<boolean> {
    const marker = await this.database.appMeta.get(INTERNAL_ROLLBACK_KEY);
    if (!marker) return false;
    try {
      const rollback = validatePayloadRelations(marker.value);
      await this.restore(rollback);
      return true;
    } catch (error) {
      throw persistenceWriteError(error);
    }
  }
}
