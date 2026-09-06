import Dexie, { type EntityTable } from 'dexie';
import { IDBKeyRange as MemoryIDBKeyRange, indexedDB as memoryIndexedDB } from 'fake-indexeddb';
import { configureMigrations, DATABASE_NAME, DATABASE_VERSION } from './migrations';
import type {
  AppMeta,
  BalanceSnapshot,
  Debt,
  Payment,
  PayLaterPayment,
  PayLaterPlan,
  PlanSettings,
  Scenario
} from './models';
import { setPersistenceMode } from './storage-mode';

function databaseOptions(): { indexedDB: IDBFactory; IDBKeyRange: typeof IDBKeyRange } {
  try {
    if (
      typeof globalThis.indexedDB !== 'undefined' &&
      typeof globalThis.IDBKeyRange !== 'undefined'
    ) {
      setPersistenceMode('persistent');
      return { indexedDB: globalThis.indexedDB, IDBKeyRange: globalThis.IDBKeyRange };
    }
  } catch {
    // Some privacy modes expose IndexedDB properties that throw when accessed.
  }

  setPersistenceMode('memory');
  return {
    indexedDB: memoryIndexedDB,
    IDBKeyRange: MemoryIDBKeyRange
  };
}

export class DebtTrackerDatabase extends Dexie {
  debts!: EntityTable<Debt, 'id'>;
  planSettings!: EntityTable<PlanSettings, 'id'>;
  scenarios!: EntityTable<Scenario, 'id'>;
  payments!: EntityTable<Payment, 'id'>;
  payLaterPlans!: EntityTable<PayLaterPlan, 'id'>;
  payLaterPayments!: EntityTable<PayLaterPayment, 'id'>;
  balanceSnapshots!: EntityTable<BalanceSnapshot, 'id'>;
  appMeta!: EntityTable<AppMeta, 'key'>;

  constructor(name = DATABASE_NAME) {
    super(name, databaseOptions());
    configureMigrations(this);

    this.on('populate', (transaction) => {
      const now = new Date().toISOString();
      return transaction.table<AppMeta, string>('appMeta').add({
        key: 'schema-version',
        value: DATABASE_VERSION,
        updatedAt: now
      });
    });
  }
}

let applicationDatabase: DebtTrackerDatabase | undefined;

export function getDatabase(): DebtTrackerDatabase {
  applicationDatabase ??= new DebtTrackerDatabase();
  return applicationDatabase;
}

export async function closeDatabase(): Promise<void> {
  applicationDatabase?.close();
  applicationDatabase = undefined;
}
