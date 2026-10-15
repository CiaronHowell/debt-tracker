import { error, json } from '@sveltejs/kit';
import { clearSessionCookie } from '$lib/server/auth';
import type { RequestHandler } from './$types';

export const prerender = false;

export const POST: RequestHandler = ({ cookies, request }) => {
  if (!(request.headers.get('content-type') ?? '').startsWith('application/json')) {
    error(415, 'Expected application/json.');
  }
  clearSessionCookie(cookies);
  return json({ ok: true });
};
