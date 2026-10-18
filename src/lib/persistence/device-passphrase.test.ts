import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { IndexedDbDevicePassphraseStore } from './device-passphrase';

const PASSPHRASE = 'correct horse battery staple';
const names: string[] = [];

function createStore(): { store: IndexedDbDevicePassphraseStore; name: string } {
  const name = `debt-tracker-device-${crypto.randomUUID()}`;
  names.push(name);
  return { store: new IndexedDbDevicePassphraseStore(name), name };
}

async function readRecord(name: string): Promise<Record<string, unknown> | undefined> {
  const database = new Dexie(name);
  database.version(1).stores({ secrets: 'id' });
  try {
    return await database.table('secrets').get('sync-passphrase');
  } finally {
    database.close();
  }
}

afterEach(async () => {
  await Promise.all(names.splice(0).map((name) => Dexie.delete(name)));
});

describe('IndexedDbDevicePassphraseStore', () => {
  it('round-trips a passphrase and forgets it on clear', async () => {
    const { store } = createStore();
    expect(store.isAvailable()).toBe(true);
    await expect(store.load()).resolves.toBeNull();

    await store.save(PASSPHRASE);
    await expect(store.load()).resolves.toBe(PASSPHRASE);
    // A second instance stands in for a page reload.
    await expect(new IndexedDbDevicePassphraseStore(names[0]).load()).resolves.toBe(PASSPHRASE);

    await store.clear();
    await expect(store.load()).resolves.toBeNull();
  });

  it('stores only ciphertext and a non-extractable key', async () => {
    const { store, name } = createStore();
    await store.save(PASSPHRASE);

    const record = await readRecord(name);
    const key = record?.key as CryptoKey;
    expect(key.extractable).toBe(false);
    await expect(globalThis.crypto.subtle.exportKey('raw', key)).rejects.toThrow();
    const ciphertext = new Uint8Array(record?.ciphertext as ArrayBuffer);
    expect(new TextDecoder().decode(ciphertext)).not.toContain(PASSPHRASE);
  });

  it('treats an unreadable record as nothing remembered and removes it', async () => {
    const { store, name } = createStore();
    await store.save(PASSPHRASE);

    const database = new Dexie(name);
    database.version(1).stores({ secrets: 'id' });
    await database.table('secrets').update('sync-passphrase', { ciphertext: new ArrayBuffer(32) });
    database.close();

    await expect(store.load()).resolves.toBeNull();
    await expect(readRecord(name)).resolves.toBeUndefined();
  });
});
