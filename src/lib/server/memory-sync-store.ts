import type { StoredRevision, SyncStore } from './sync-store';

/** In-memory `SyncStore` for tests; mirrors the append-only semantics of the Blob store. */
export class MemorySyncStore implements SyncStore {
  readonly revisions = new Map<number, StoredRevision>();

  async headRevision(): Promise<number> {
    return Math.max(0, ...this.revisions.keys());
  }

  async read(): Promise<StoredRevision | null> {
    return structuredClone(this.revisions.get(await this.headRevision()) ?? null);
  }

  async create(record: StoredRevision): Promise<boolean> {
    if (this.revisions.has(record.revision)) return false;
    this.revisions.set(record.revision, structuredClone(record));
    return true;
  }

  async prune(keep: number): Promise<void> {
    const ordered = [...this.revisions.keys()].sort((left, right) => left - right);
    for (const revision of ordered.slice(0, -keep)) this.revisions.delete(revision);
  }
}
