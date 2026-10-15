import { redirect } from '@sveltejs/kit';
import { serverConfig, setSessionCookie } from '$lib/server/auth';
import { fetchGitHubUser } from '$lib/server/github';
import { OAUTH_STATE_COOKIE } from '$lib/server/session';
import type { RequestHandler } from './$types';

export const prerender = false;

export const GET: RequestHandler = async ({ cookies, url, fetch }) => {
  const config = serverConfig();
  const expectedState = cookies.get(OAUTH_STATE_COOKIE);
  cookies.delete(OAUTH_STATE_COOKIE, { path: '/api/auth' });

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || !state || !expectedState || state !== expectedState) {
    redirect(303, '/account?error=state');
  }

  const user = await fetchGitHubUser(
    code,
    `${url.origin}/api/auth/callback`,
    {
      clientId: config.githubClientId,
      clientSecret: config.githubClientSecret
    },
    fetch
  );
  if (!user) redirect(303, '/account?error=github');
  if (String(user.id) !== config.allowedGithubId) redirect(303, '/account?denied');

  setSessionCookie(cookies, { githubId: user.id, login: user.login }, config);
  redirect(303, '/account?signed-in');
};
