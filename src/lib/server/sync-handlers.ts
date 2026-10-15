import { pushRequestSchema, type PushResult, type RemoteState } from '$lib/sync/protocol';
import type { SyncStore } from './sync-store';

export const REVISIONS_TO_KEEP = 10;

export type PushResponse =
  | { status: 200; body: PushResult }
  | { status: 409; body: { revision: number } }
  | { status: 400; body: { message: string } };

export async function readRemoteState(store: SyncStore, metaOnly: boolean): Promise<RemoteState> {
  if (metaOnly) {
    return { revision: await store.headRevision(), updatedAt: null, envelope: null };
  }
  const stored = await store.read();
  return stored ?? { revision: 0, updatedAt: null, envelope: null };
}

export async function pushRemoteState(
  store: SyncStore,
  body: unknown,
  now: () => string = () => new Date().toISOString()
): Promise<PushResponse> {
  const parsed = pushRequestSchema.safeParse(body);
  if (!parsed.success) return { status: 400, body: { message: 'Invalid sync payload.' } };

  const { baseRevision, envelope } = parsed.data;
  const head = await store.headRevision();
  if (head !== baseRevision) return { status: 409, body: { revision: head } };

  const record = { revision: baseRevision + 1, updatedAt: now(), envelope };
  if (!(await store.create(record))) {
    return { status: 409, body: { revision: await store.headRevision() } };
  }

  try {
    await store.prune(REVISIONS_TO_KEEP);
  } catch {
    // History pruning is best-effort; the new revision is already committed.
  }
  return { status: 200, body: { revision: record.revision, updatedAt: record.updatedAt } };
}
