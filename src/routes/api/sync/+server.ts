import { error, json } from '@sveltejs/kit';
import { requireOwner } from '$lib/server/auth';
import { pushRemoteState, readRemoteState } from '$lib/server/sync-handlers';
import { VercelBlobSyncStore } from '$lib/server/sync-store';
import { MAX_SYNC_BODY_BYTES } from '$lib/sync/protocol';
import type { RequestHandler } from './$types';

export const prerender = false;

export const GET: RequestHandler = async (event) => {
  const { config } = requireOwner(event);
  event.setHeaders({ 'cache-control': 'no-store' });
  const store = new VercelBlobSyncStore(config.blobToken);
  return json(await readRemoteState(store, event.url.searchParams.get('meta') === '1'));
};

export const PUT: RequestHandler = async (event) => {
  const { config } = requireOwner(event);
  const declaredLength = Number(event.request.headers.get('content-length') ?? 0);
  if (declaredLength > MAX_SYNC_BODY_BYTES) error(413, 'Sync payload is too large.');
  const text = await event.request.text();
  if (text.length > MAX_SYNC_BODY_BYTES) error(413, 'Sync payload is too large.');

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    error(400, 'Invalid JSON.');
  }

  const result = await pushRemoteState(new VercelBlobSyncStore(config.blobToken), body);
  return json(result.body, { status: result.status });
};
