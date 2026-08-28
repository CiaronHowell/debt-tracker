import type { Table } from 'dexie';
import type { DebtTrackerDatabase } from './db';
import {
  dispatchPersistenceWriteEvent,
  PERSISTENCE_WRITE_ERROR_EVENT,
  PERSISTENCE_WRITE_START_EVENT,
  PERSISTENCE_WRITE_SUCCESS_EVENT
} from './events';

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
  dispatchPersistenceWriteEvent(PERSISTENCE_WRITE_START_EVENT);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = await database.transaction('rw', uniqueTables, async () => {
        const actionResult = await action();
        const updatedAt = now();
        await database.appMeta.put({
          key: 'last-successful-write-at',
          value: updatedAt,
          updatedAt
        });
        return actionResult;
      });
      dispatchPersistenceWriteEvent(PERSISTENCE_WRITE_SUCCESS_EVENT);
      return result;
    } catch (error) {
      if (attempt === 0 && isTransientPersistenceError(error)) continue;
      dispatchPersistenceWriteEvent(PERSISTENCE_WRITE_ERROR_EVENT);
      throw error;
    }
  }

  dispatchPersistenceWriteEvent(PERSISTENCE_WRITE_ERROR_EVENT);
  throw new Error('Unreachable persistence retry state.');
}
