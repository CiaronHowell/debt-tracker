import { describe, expect, it } from 'vitest';
import type { EncryptedBackupEnvelope } from '$lib/persistence/models';
import { MemorySyncStore } from './memory-sync-store';
import { pushRemoteState, readRemoteState, REVISIONS_TO_KEEP } from './sync-handlers';

const NOW = '2026-10-15T09:00:00.000Z';

function envelope(marker: string): EncryptedBackupEnvelope {
  return {
    format: 'debt-tracker-backup-encrypted',
    version: 1,
    exportedAt: NOW,
    encryption: {
      algorithm: 'AES-256-GCM',
      keyDerivation: 'PBKDF2-HMAC-SHA-256',
      iterations: 600_000,
      salt: 'c2FsdA==',
      iv: 'aXY='
    },
    ciphertext: marker
  };
}

describe('sync handlers', () => {
  it('reports an empty remote as revision 0', async () => {
    const store = new MemorySyncStore();
    await expect(readRemoteState(store, false)).resolves.toEqual({
      revision: 0,
      updatedAt: null,
      envelope: null
    });
  });

  it('appends a revision when the base matches the head', async () => {
    const store = new MemorySyncStore();
    const result = await pushRemoteState(
      store,
      { baseRevision: 0, envelope: envelope('one') },
      () => NOW
    );
    expect(result).toEqual({ status: 200, body: { revision: 1, updatedAt: NOW } });
    await expect(readRemoteState(store, true)).resolves.toMatchObject({
      revision: 1,
      envelope: null
    });
    await expect(readRemoteState(store, false)).resolves.toMatchObject({
      revision: 1,
      envelope: { ciphertext: 'one' }
    });
  });

  it('returns 409 with the head revision for a stale base', async () => {
    const store = new MemorySyncStore();
    await pushRemoteState(store, { baseRevision: 0, envelope: envelope('one') });
    const stale = await pushRemoteState(store, { baseRevision: 0, envelope: envelope('two') });
    expect(stale).toEqual({ status: 409, body: { revision: 1 } });
    await expect(readRemoteState(store, false)).resolves.toMatchObject({
      envelope: { ciphertext: 'one' }
    });
  });

  it('returns 409 when another writer claims the revision first', async () => {
    const store = new MemorySyncStore();
    const racing = Object.assign(Object.create(store) as MemorySyncStore, {
      create: async () => {
        await store.create({ revision: 1, updatedAt: NOW, envelope: envelope('winner') });
        return false;
      }
    });
    const result = await pushRemoteState(racing, { baseRevision: 0, envelope: envelope('loser') });
    expect(result).toEqual({ status: 409, body: { revision: 1 } });
  });

  it('rejects payloads that are not encrypted envelopes', async () => {
    const store = new MemorySyncStore();
    const result = await pushRemoteState(store, {
      baseRevision: 0,
      envelope: { format: 'debt-tracker-backup', version: 1, exportedAt: NOW, payload: {} }
    });
    expect(result.status).toBe(400);
    expect(store.revisions.size).toBe(0);
  });

  it(`keeps only the latest ${REVISIONS_TO_KEEP} revisions`, async () => {
    const store = new MemorySyncStore();
    for (let revision = 0; revision < REVISIONS_TO_KEEP + 3; revision += 1) {
      await pushRemoteState(store, { baseRevision: revision, envelope: envelope(`r${revision}`) });
    }
    expect(store.revisions.size).toBe(REVISIONS_TO_KEEP);
    expect(await store.headRevision()).toBe(REVISIONS_TO_KEEP + 3);
  });
});
