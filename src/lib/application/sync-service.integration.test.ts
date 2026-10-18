import { afterEach, describe, expect, it } from 'vitest';
import { DebtTrackerDatabase } from '$lib/persistence/db';
import type { DevicePassphraseStore } from '$lib/persistence/device-passphrase';
import { MemorySyncStore } from '$lib/server/memory-sync-store';
import { pushRemoteState, readRemoteState } from '$lib/server/sync-handlers';
import { LOGOUT_API_PATH, SESSION_API_PATH, SYNC_API_PATH } from '$lib/sync/protocol';
import { DebtService } from './debt-service';
import { SyncService, SYNC_STATE_STORAGE_KEY } from './sync-service';

const PASSPHRASE = 'correct horse battery staple';
const databases: DebtTrackerDatabase[] = [];
let clock = Date.parse('2026-10-15T09:00:00.000Z');

function tick(): string {
  clock += 1_000;
  return new Date(clock).toISOString();
}

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    removeItem: (key) => void values.delete(key)
  };
}

function memoryPassphraseStore(): DevicePassphraseStore & { stored: string | null } {
  return {
    stored: null,
    isAvailable: () => true,
    async load() {
      return this.stored;
    },
    async save(passphrase) {
      this.stored = passphrase;
    },
    async clear() {
      this.stored = null;
    }
  };
}

function createCloud(options: { authorized?: boolean } = {}) {
  const store = new MemorySyncStore();
  const fetch: typeof globalThis.fetch = async (input, init) => {
    if (options.authorized === false) return new Response(null, { status: 401 });
    const url = new URL(String(input), 'http://localhost');
    const method = init?.method ?? 'GET';
    if (url.pathname === SYNC_API_PATH && method === 'GET') {
      return Response.json(await readRemoteState(store, url.searchParams.get('meta') === '1'));
    }
    if (url.pathname === SYNC_API_PATH && method === 'PUT') {
      const result = await pushRemoteState(store, JSON.parse(String(init?.body)), tick);
      return Response.json(result.body, { status: result.status });
    }
    if (url.pathname === SESSION_API_PATH) {
      return Response.json({ authenticated: true, login: 'owner' });
    }
    if (url.pathname === LOGOUT_API_PATH) return Response.json({ ok: true });
    return new Response(null, { status: 404 });
  };
  return { store, fetch };
}

function createDevice(cloud: ReturnType<typeof createCloud>, label: string) {
  const database = new DebtTrackerDatabase(`debt-tracker-sync-${label}-${crypto.randomUUID()}`);
  databases.push(database);
  const storage = memoryStorage();
  const passphraseStore = memoryPassphraseStore();
  const sync = new SyncService(database, { fetch: cloud.fetch, storage, passphraseStore });
  sync.enable();
  const debts = new DebtService(database, { now: tick });
  return {
    database,
    storage,
    passphraseStore,
    sync,
    /** A fresh service on the same device, as after a page reload. */
    reload: () => new SyncService(database, { fetch: cloud.fetch, storage, passphraseStore }),
    addDebt: (name: string) =>
      debts.create({
        name,
        type: 'credit-card',
        startingBalanceMinor: 50_000,
        balanceAsOf: '2026-10-15',
        aprBasisPoints: 1_999,
        promotionalAprEndsOn: null,
        minimumPaymentMinor: 2_500,
        dueDay: 1,
        notes: '',
        colorKey: null
      }),
    debtNames: async () =>
      (await database.debts.toArray()).map((debt) => debt.name).sort((a, b) => a.localeCompare(b))
  };
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.delete()));
});

describe('SyncService', { timeout: 60_000 }, () => {
  it('uploads from the first device and restores onto an empty second device', async () => {
    const cloud = createCloud();
    const laptop = createDevice(cloud, 'laptop');
    await laptop.addDebt('Visa');

    await expect(laptop.sync.unlock(PASSPHRASE)).resolves.toEqual({ remoteExists: false });
    await expect(laptop.sync.sync()).resolves.toEqual({ action: 'push', revision: 1 });
    // The upload itself must not look like a local change.
    await expect(laptop.sync.sync()).resolves.toEqual({ action: 'noop', revision: 1 });

    const stored = cloud.store.revisions.get(1);
    expect(stored?.envelope.format).toBe('debt-tracker-backup-encrypted');
    expect(JSON.stringify(stored)).not.toContain('Visa');

    const phone = createDevice(cloud, 'phone');
    await expect(phone.sync.unlock(PASSPHRASE)).resolves.toEqual({ remoteExists: true });
    await expect(phone.sync.sync()).resolves.toEqual({ action: 'pull', revision: 1 });
    expect(await phone.debtNames()).toEqual(['Visa']);
    await expect(phone.sync.sync()).resolves.toEqual({ action: 'noop', revision: 1 });
  });

  it('propagates later edits in both directions', async () => {
    const cloud = createCloud();
    const laptop = createDevice(cloud, 'laptop');
    const phone = createDevice(cloud, 'phone');
    await laptop.addDebt('Visa');
    await laptop.sync.unlock(PASSPHRASE);
    await laptop.sync.sync();
    await phone.sync.unlock(PASSPHRASE);
    await phone.sync.sync();

    await phone.addDebt('Loan');
    await expect(phone.sync.sync()).resolves.toEqual({ action: 'push', revision: 2 });
    await expect(laptop.sync.sync()).resolves.toEqual({ action: 'pull', revision: 2 });
    expect(await laptop.debtNames()).toEqual(['Loan', 'Visa']);
  });

  it('rejects a passphrase that cannot decrypt the cloud copy', async () => {
    const cloud = createCloud();
    const laptop = createDevice(cloud, 'laptop');
    await laptop.addDebt('Visa');
    await laptop.sync.unlock(PASSPHRASE);
    await laptop.sync.sync();

    const phone = createDevice(cloud, 'phone');
    await expect(phone.sync.unlock('wrong passphrase')).rejects.toMatchObject({
      code: 'SYNC_PASSPHRASE_INVALID'
    });
    expect(phone.sync.isUnlocked()).toBe(false);
    await expect(phone.sync.sync()).rejects.toMatchObject({ code: 'SYNC_LOCKED' });
  });

  it('reports a conflict when both devices changed, and resolves it either way', async () => {
    const cloud = createCloud();
    const laptop = createDevice(cloud, 'laptop');
    const phone = createDevice(cloud, 'phone');
    await laptop.addDebt('Visa');
    await laptop.sync.unlock(PASSPHRASE);
    await laptop.sync.sync();
    await phone.sync.unlock(PASSPHRASE);
    await phone.sync.sync();

    await laptop.addDebt('Car loan');
    await laptop.sync.sync();
    await phone.addDebt('Store card');
    await phone.addDebt('Overdraft');

    const outcome = await phone.sync.sync();
    expect(outcome).toMatchObject({
      action: 'conflict',
      conflict: { remoteRevision: 2, remote: { debts: 2 }, local: { debts: 3 } }
    });
    // Nothing was overwritten while waiting for a decision.
    expect(await phone.debtNames()).toEqual(['Overdraft', 'Store card', 'Visa']);

    await expect(phone.sync.resolveConflict('keep-device')).resolves.toBe(3);
    await expect(laptop.sync.sync()).resolves.toEqual({ action: 'pull', revision: 3 });
    expect(await laptop.debtNames()).toEqual(['Overdraft', 'Store card', 'Visa']);

    await laptop.addDebt('Mortgage');
    await phone.addDebt('Phone contract');
    await laptop.sync.sync();
    await expect(phone.sync.sync()).resolves.toMatchObject({ action: 'conflict' });
    await expect(phone.sync.resolveConflict('use-cloud')).resolves.toBe(4);
    expect(await phone.debtNames()).toEqual(['Mortgage', 'Overdraft', 'Store card', 'Visa']);
  });

  it('asks before replacing data on a device that has never synced', async () => {
    const cloud = createCloud();
    const laptop = createDevice(cloud, 'laptop');
    await laptop.addDebt('Visa');
    await laptop.sync.unlock(PASSPHRASE);
    await laptop.sync.sync();

    const tablet = createDevice(cloud, 'tablet');
    await tablet.addDebt('Tablet-only debt');
    await tablet.sync.unlock(PASSPHRASE);
    await expect(tablet.sync.sync()).resolves.toMatchObject({ action: 'conflict' });
    expect(await tablet.debtNames()).toEqual(['Tablet-only debt']);
  });

  it('remembers the passphrase across a reload only when asked', async () => {
    const cloud = createCloud();
    const laptop = createDevice(cloud, 'laptop');
    await laptop.addDebt('Visa');

    await laptop.sync.unlock(PASSPHRASE);
    await laptop.sync.sync();
    expect(laptop.passphraseStore.stored).toBeNull();
    await expect(laptop.reload().resume()).resolves.toBe(false);

    await laptop.sync.lock();
    await laptop.sync.unlock(PASSPHRASE, { remember: true });
    const reloaded = laptop.reload();
    expect(reloaded.isUnlocked()).toBe(false);
    await expect(reloaded.resume()).resolves.toBe(true);
    expect(reloaded.isUnlocked()).toBe(true);
    await expect(reloaded.sync()).resolves.toEqual({ action: 'noop', revision: 1 });

    await laptop.addDebt('Loan');
    await expect(reloaded.sync()).resolves.toEqual({ action: 'push', revision: 2 });
  });

  it('forgets a remembered passphrase on lock and on disable', async () => {
    const device = createDevice(createCloud(), 'forget');

    await device.sync.unlock(PASSPHRASE, { remember: true });
    await device.sync.lock();
    expect(device.passphraseStore.stored).toBeNull();
    await expect(device.reload().resume()).resolves.toBe(false);

    await device.sync.unlock(PASSPHRASE, { remember: true });
    await device.sync.disable();
    expect(device.passphraseStore.stored).toBeNull();
    // A disabled device never resumes, even if something was left behind.
    await device.passphraseStore.save(PASSPHRASE);
    await expect(device.reload().resume()).resolves.toBe(false);
  });

  it('locks a remembered passphrase that no longer decrypts the cloud copy', async () => {
    const cloud = createCloud();
    const laptop = createDevice(cloud, 'laptop');
    await laptop.addDebt('Visa');
    await laptop.sync.unlock(PASSPHRASE, { remember: true });
    await laptop.sync.sync();

    // The cloud is emptied and re-seeded from another device with a different passphrase.
    cloud.store.revisions.clear();
    const phone = createDevice(cloud, 'phone');
    await phone.addDebt('Loan');
    await phone.sync.unlock('a different passphrase');
    await expect(phone.sync.sync()).resolves.toEqual({ action: 'push', revision: 1 });
    await phone.addDebt('Store card');
    await phone.sync.sync();

    const reloaded = laptop.reload();
    await expect(reloaded.resume()).resolves.toBe(true);
    await expect(reloaded.sync()).rejects.toMatchObject({ code: 'SYNC_PASSPHRASE_INVALID' });
    expect(reloaded.isUnlocked()).toBe(false);
    expect(laptop.passphraseStore.stored).toBeNull();
    expect(await laptop.debtNames()).toEqual(['Visa']);
  });

  it('surfaces an expired sign-in and forgets device state on disable', async () => {
    const device = createDevice(createCloud({ authorized: false }), 'expired');
    await expect(device.sync.unlock(PASSPHRASE)).rejects.toMatchObject({
      code: 'SYNC_UNAUTHORIZED'
    });

    expect(device.storage.getItem(SYNC_STATE_STORAGE_KEY)).not.toBeNull();
    await device.sync.disable();
    expect(device.sync.isEnabled()).toBe(false);
    expect(device.storage.getItem(SYNC_STATE_STORAGE_KEY)).toBeNull();
  });
});
