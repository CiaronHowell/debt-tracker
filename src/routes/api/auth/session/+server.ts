import { json } from '@sveltejs/kit';
import { readOwnerSession, serverConfig } from '$lib/server/auth';
import type { SessionResult } from '$lib/sync/protocol';
import type { RequestHandler } from './$types';

export const prerender = false;

export const GET: RequestHandler = ({ cookies, setHeaders }) => {
  setHeaders({ 'cache-control': 'no-store' });
  const session = readOwnerSession(cookies, serverConfig());
  return json({
    authenticated: session !== null,
    login: session?.login ?? null
  } satisfies SessionResult);
};
