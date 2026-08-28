export type PersistenceMode = 'persistent' | 'memory';

export const PERSISTENCE_MODE_CHANGE_EVENT = 'debt-tracker:persistence-mode-change';

let persistenceMode: PersistenceMode = 'persistent';

export function getPersistenceMode(): PersistenceMode {
  return persistenceMode;
}

export function setPersistenceMode(mode: PersistenceMode): void {
  if (mode === persistenceMode) return;
  persistenceMode = mode;
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(PERSISTENCE_MODE_CHANGE_EVENT, { detail: { mode } }));
  }
}
