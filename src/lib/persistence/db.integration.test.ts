import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { DebtTrackerDatabase } from './db';
import { DATABASE_VERSION, LEGACY_SCHEMA } from './migrations';
import type { Debt } from './models';
import { runWriteTransaction } from './transactions';

const FIXED_NOW = '2026-08-28T08:00:00.000Z';
const databases: DebtTrackerDatabase[] = [];

function validDebt(overrides: Partial<Debt> = {}): Debt {
  return {
    id: 'debt-1',
    name: 'Card',
    type: 'credit-card',
    startingBalanceMinor: 10_000,
    currentBalanceMinor: 10_000,
    balanceAsOf: '2026-08-28',
    balanceSource: 'user',
    aprBasisPoints: 1_999,
    minimumPaymentMinor: 1_000,
    dueDay: 12,
    notes: '',
    colorKey: null,
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    archivedAt: null,
    ...overrides
  };
}

function createDatabase(label: string): DebtTrackerDatabase {
  const database = new DebtTrackerDatabase(`debt-tracker-${label}-${crypto.randomUUID()}`);
  databases.push(database);
  return database;
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.delete()));
});

describe('DebtTrackerDatabase', () => {
  it('initializes all v1 tables and schema metadata', async () => {
    const database = createDatabase('initialize');
    await database.open();

    expect(database.tables.map((table) => table.name).sort()).toEqual([
      'appMeta',
      'balanceSnapshots',
      'debts',
      'payments',
      'planSettings',
      'scenarios'
    ]);
    await expect(database.appMeta.get('schema-version')).resolves.toMatchObject({
      value: DATABASE_VERSION
    });
  });

  it('migrates the additive pre-v1 schema and fills debt defaults', async () => {
    const name = `debt-tracker-migration-${crypto.randomUUID()}`;
    const legacy = new Dexie(name);
    legacy.version(0.9).stores(LEGACY_SCHEMA);
    await legacy.open();
    const debt = validDebt();
    const legacyDebt: Partial<Debt> = { ...debt };
    delete legacyDebt.balanceSource;
    delete legacyDebt.archivedAt;
    await legacy.table('debts').add(legacyDebt);
    legacy.close();

    const database = new DebtTrackerDatabase(name);
    databases.push(database);
    await database.open();

    await expect(database.debts.get(debt.id)).resolves.toMatchObject({
      id: debt.id,
      balanceSource: 'user',
      archivedAt: null,
      notes: '',
      colorKey: null
    });
    await expect(database.appMeta.get('schema-version')).resolves.toMatchObject({
      value: DATABASE_VERSION
    });
  });

  it('rolls back every entity and metadata write when a command fails', async () => {
    const database = createDatabase('rollback');
    await database.open();

    await expect(
      runWriteTransaction(
        database,
        [database.debts, database.planSettings],
        async () => {
          await database.debts.add(validDebt());
          await database.planSettings.add({
            id: 'primary',
            currency: 'GBP',
            startMonth: '2026-08',
            monthlyBudgetMinor: 2_000,
            activeScenarioId: null,
            setupCompletedAt: null,
            updatedAt: FIXED_NOW
          });
          throw new Error('deliberate failure');
        },
        () => FIXED_NOW
      )
    ).rejects.toThrow('deliberate failure');

    await expect(database.debts.count()).resolves.toBe(0);
    await expect(database.planSettings.count()).resolves.toBe(0);
    await expect(database.appMeta.get('last-successful-write-at')).resolves.toBeUndefined();
  });
});
