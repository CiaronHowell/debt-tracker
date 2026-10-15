import { redirect } from '@sveltejs/kit';
import { serverConfig } from '$lib/server/auth';
import { githubAuthorizeUrl } from '$lib/server/github';
import { OAUTH_STATE_COOKIE } from '$lib/server/session';
import type { RequestHandler } from './$types';

export const prerender = false;

export const GET: RequestHandler = ({ cookies, url }) => {
  const config = serverConfig();
  const state = crypto.randomUUID();
  cookies.set(OAUTH_STATE_COOKIE, state, {
    path: '/api/auth',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 600
  });
  redirect(
    302,
    githubAuthorizeUrl(config.githubClientId, `${url.origin}/api/auth/callback`, state)
  );
};
