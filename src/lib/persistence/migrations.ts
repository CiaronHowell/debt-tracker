import type Dexie from 'dexie';
import type { Transaction } from 'dexie';
import type { AppMeta, Debt } from './models';

export const DATABASE_VERSION = 1;
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

export function configureMigrations(database: Dexie): void {
  database.version(0.9).stores(LEGACY_SCHEMA);
  database.version(DATABASE_VERSION).stores(V1_SCHEMA).upgrade(migratePreReleaseToV1);
}
