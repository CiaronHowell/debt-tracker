export const PERSISTENCE_WRITE_START_EVENT = 'debt-tracker:persistence-write-start';
export const PERSISTENCE_WRITE_SUCCESS_EVENT = 'debt-tracker:persistence-write-success';
export const PERSISTENCE_WRITE_ERROR_EVENT = 'debt-tracker:persistence-write-error';

export type PersistenceWriteEventName =
  | typeof PERSISTENCE_WRITE_START_EVENT
  | typeof PERSISTENCE_WRITE_SUCCESS_EVENT
  | typeof PERSISTENCE_WRITE_ERROR_EVENT;

export function dispatchPersistenceWriteEvent(type: PersistenceWriteEventName): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(type));
}
