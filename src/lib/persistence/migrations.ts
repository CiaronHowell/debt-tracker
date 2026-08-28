import type Dexie from 'dexie';
import type { Transaction } from 'dexie';
import type { AppMeta, Debt, Scenario } from './models';

export const DATABASE_VERSION = 2;
export const DATABASE_NAME = 'debt-tracker';

export const LEGACY_SCHEMA = {
  debts: '&id, updatedAt',
  planSettings: '&id',
  scenarios: '&id, createdAt, updatedAt',
  payments: '&id, debtId, paidOn, createdAt'
} as const;

export const V1_SCHEMA = {
  debts: '&id, archivedAt, updatedAt',
  planSettings: '&id',
  scenarios: '&id, createdAt, updatedAt',
  payments: '&id, debtId, paidOn, createdAt',
  balanceSnapshots: '&id, debtId, recordedOn, createdAt',
  appMeta: '&key'
} as const;

interface LegacyDebt extends Partial<Debt> {
  id: string;
}

async function migratePreReleaseToV1(transaction: Transaction): Promise<void> {
  await transaction
    .table<LegacyDebt, string>('debts')
    .toCollection()
    .modify((debt) => {
      debt.balanceSource ??= 'user';
      debt.archivedAt ??= null;
      debt.notes ??= '';
      debt.colorKey ??= null;
    });

  const now = new Date().toISOString();
  await transaction.table<AppMeta, string>('appMeta').put({
    key: 'schema-version',
    value: DATABASE_VERSION,
    updatedAt: now
  });
}

async function migrateV1ToV2(transaction: Transaction): Promise<void> {
  await transaction
    .table<Debt, string>('debts')
    .toCollection()
    .modify((debt) => {
      debt.promotionalAprEndsOn ??= null;
    });

  await transaction
    .table<Scenario, string>('scenarios')
    .toCollection()
    .modify((scenario) => {
      scenario.debtSnapshot = scenario.debtSnapshot.map((debt) => ({
        ...debt,
        promotionalAprEndsOn: debt.promotionalAprEndsOn ?? null
      }));
    });

  await transaction.table<AppMeta, string>('appMeta').put({
    key: 'schema-version',
    value: DATABASE_VERSION,
    updatedAt: new Date().toISOString()
  });
}

export function configureMigrations(database: Dexie): void {
  database.version(0.9).stores(LEGACY_SCHEMA);
  database.version(1).stores(V1_SCHEMA).upgrade(migratePreReleaseToV1);
  database.version(DATABASE_VERSION).stores(V1_SCHEMA).upgrade(migrateV1ToV2);
}
