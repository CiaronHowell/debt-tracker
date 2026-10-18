import Dexie, { type EntityTable } from 'dexie';
import { getPersistenceMode } from './storage-mode';

export const DEVICE_DATABASE_NAME = 'debt-tracker-device';
const PASSPHRASE_RECORD_ID = 'sync-passphrase';
const IV_BYTES = 12;

/** Keeps the owner's sync passphrase on this device when they choose "Remember this device". */
export interface DevicePassphraseStore {
  isAvailable(): boolean;
  load(): Promise<string | null>;
  save(passphrase: string): Promise<void>;
  clear(): Promise<void>;
}

interface StoredPassphrase {
  id: string;
  /** Non-extractable AES-GCM key: script can use it on this device but never read its bytes. */
  key: CryptoKey;
  iv: Uint8Array<ArrayBuffer>;
  ciphertext: ArrayBuffer;
}

class DeviceDatabase extends Dexie {
  secrets!: EntityTable<StoredPassphrase, 'id'>;

  constructor(name: string) {
    super(name);
    this.version(1).stores({ secrets: 'id' });
  }
}

/**
 * A separate IndexedDB database, so the remembered passphrase never enters the data
 * database, backups, or a backup import's replace.
 */
export class IndexedDbDevicePassphraseStore implements DevicePassphraseStore {
  private database: DeviceDatabase | undefined;

  constructor(private readonly name = DEVICE_DATABASE_NAME) {}

  isAvailable(): boolean {
    try {
      return typeof globalThis.indexedDB !== 'undefined' && getPersistenceMode() !== 'memory';
    } catch {
      return false;
    }
  }

  async load(): Promise<string | null> {
    if (!this.isAvailable()) return null;
    try {
      const record = await this.secrets().get(PASSPHRASE_RECORD_ID);
      if (!record) return null;
      const plaintext = await globalThis.crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: record.iv },
        record.key,
        record.ciphertext
      );
      return new TextDecoder('utf-8', { fatal: true }).decode(plaintext);
    } catch {
      await this.clear();
      return null;
    }
  }

  async save(passphrase: string): Promise<void> {
    if (!this.isAvailable()) return;
    const key = await globalThis.crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
    const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_BYTES));
    const ciphertext = await globalThis.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      new TextEncoder().encode(passphrase)
    );
    await this.secrets().put({ id: PASSPHRASE_RECORD_ID, key, iv, ciphertext });
  }

  async clear(): Promise<void> {
    if (!this.isAvailable()) return;
    try {
      await this.secrets().delete(PASSPHRASE_RECORD_ID);
    } catch {
      // Nothing usable is stored if the device database cannot be opened.
    }
  }

  private secrets(): DeviceDatabase['secrets'] {
    this.database ??= new DeviceDatabase(this.name);
    return this.database.secrets;
  }
}
