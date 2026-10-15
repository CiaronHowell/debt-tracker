import { del, get, list, put } from '@vercel/blob';
import { z } from 'zod';
import { encryptedBackupEnvelopeSchema } from '$lib/persistence/schemas';
import type { EncryptedBackupEnvelope } from '$lib/persistence/models';

export interface StoredRevision {
  revision: number;
  updatedAt: string;
  envelope: EncryptedBackupEnvelope;
}

/**
 * Append-only revision store. `create` must be atomic: it returns false when the
 * revision already exists, which is how concurrent pushes are detected.
 */
export interface SyncStore {
  headRevision(): Promise<number>;
  read(): Promise<StoredRevision | null>;
  create(record: StoredRevision): Promise<boolean>;
  prune(keep: number): Promise<void>;
}

const storedRevisionSchema = z.strictObject({
  revision: z.number().int().min(1),
  updatedAt: z.string(),
  envelope: encryptedBackupEnvelopeSchema
});

const PREFIX = 'sync/';
const PATHNAME_PATTERN = /^sync\/rev-(\d{9})\.json$/;

function pathnameFor(revision: number): string {
  return `${PREFIX}rev-${String(revision).padStart(9, '0')}.json`;
}

interface RevisionEntry {
  revision: number;
  url: string;
}

export class VercelBlobSyncStore implements SyncStore {
  constructor(private readonly token: string) {}

  private async listRevisions(): Promise<RevisionEntry[]> {
    const entries: RevisionEntry[] = [];
    let cursor: string | undefined;
    do {
      const page = await list({ prefix: PREFIX, cursor, token: this.token });
      for (const blob of page.blobs) {
        const match = PATHNAME_PATTERN.exec(blob.pathname);
        if (match) entries.push({ revision: Number(match[1]), url: blob.url });
      }
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return entries.sort((left, right) => left.revision - right.revision);
  }

  async headRevision(): Promise<number> {
    return (await this.listRevisions()).at(-1)?.revision ?? 0;
  }

  async read(): Promise<StoredRevision | null> {
    const head = await this.headRevision();
    if (head === 0) return null;
    const result = await get(pathnameFor(head), {
      access: 'private',
      useCache: false,
      token: this.token
    });
    if (!result || result.statusCode !== 200) return null;
    const text = await new Response(result.stream).text();
    return storedRevisionSchema.parse(JSON.parse(text)) as StoredRevision;
  }

  async create(record: StoredRevision): Promise<boolean> {
    try {
      await put(pathnameFor(record.revision), JSON.stringify(record), {
        access: 'private',
        addRandomSuffix: false,
        allowOverwrite: false,
        contentType: 'application/json',
        token: this.token
      });
      return true;
    } catch (error) {
      // Blob reports an existing pathname as a generic error; confirm by re-reading the head.
      if ((await this.headRevision()) >= record.revision) return false;
      throw error;
    }
  }

  async prune(keep: number): Promise<void> {
    const stale = (await this.listRevisions()).slice(0, -keep);
    if (stale.length)
      await del(
        stale.map((entry) => entry.url),
        { token: this.token }
      );
  }
}
