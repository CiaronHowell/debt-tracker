import type { Table } from 'dexie';
import type { DebtTrackerDatabase } from './db';

const TRANSIENT_ERROR_NAMES = new Set(['AbortError', 'TimeoutError', 'UnknownError']);

export function isTransientPersistenceError(error: unknown): boolean {
  return error instanceof Error && TRANSIENT_ERROR_NAMES.has(error.name);
}

export async function runWriteTransaction<T>(
  database: DebtTrackerDatabase,
  tables: Table[],
  action: () => Promise<T>,
  now: () => string = () => new Date().toISOString()
): Promise<T> {
  const uniqueTables = [...new Set([...tables, database.appMeta])];

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await database.transaction('rw', uniqueTables, async () => {
        const result = await action();
        const updatedAt = now();
        await database.appMeta.put({
          key: 'last-successful-write-at',
          value: updatedAt,
          updatedAt
        });
        return result;
      });
    } catch (error) {
      if (attempt === 0 && isTransientPersistenceError(error)) continue;
      throw error;
    }
  }

  throw new Error('Unreachable persistence retry state.');
}
