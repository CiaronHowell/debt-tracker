export type SyncAction = 'noop' | 'push' | 'pull' | 'conflict';

export interface SyncDecisionInput {
  /** Remote revision this device last pushed or pulled; null if it has never synced. */
  baseRevision: number | null;
  /** Current remote head revision; 0 when nothing has been uploaded yet. */
  remoteRevision: number;
  /** Whether local data changed since the last successful sync. */
  localDirty: boolean;
  /** Whether this device holds no user data. */
  localEmpty: boolean;
}

export function decideSync({
  baseRevision,
  remoteRevision,
  localDirty,
  localEmpty
}: SyncDecisionInput): SyncAction {
  if (remoteRevision === 0) {
    if (baseRevision === null && localEmpty) return 'noop';
    return 'push';
  }

  if (baseRevision === null) return localEmpty ? 'pull' : 'conflict';

  if (remoteRevision === baseRevision) return localDirty ? 'push' : 'noop';

  // Remote moved on (or was reset below our base): only safe to take it if we have nothing to lose.
  return localDirty ? 'conflict' : 'pull';
}
