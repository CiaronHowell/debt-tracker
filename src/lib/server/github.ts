export interface GitHubUser {
  id: number;
  login: string;
}

export function githubAuthorizeUrl(clientId: string, redirectUri: string, state: string): string {
  const url = new URL('https://github.com/login/oauth/authorize');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('state', state);
  // No scope: only the public identity is needed to match the allowlisted account.
  url.searchParams.set('allow_signup', 'false');
  return url.toString();
}

export async function fetchGitHubUser(
  code: string,
  redirectUri: string,
  credentials: { clientId: string; clientSecret: string },
  fetcher: typeof fetch = fetch
): Promise<GitHubUser | null> {
  const tokenResponse = await fetcher('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      code,
      redirect_uri: redirectUri
    })
  });
  if (!tokenResponse.ok) return null;
  const token = (await tokenResponse.json()) as { access_token?: unknown };
  if (typeof token.access_token !== 'string') return null;

  const userResponse = await fetcher('https://api.github.com/user', {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token.access_token}`,
      'user-agent': 'debt-tracker-owner-sync'
    }
  });
  if (!userResponse.ok) return null;
  const user = (await userResponse.json()) as { id?: unknown; login?: unknown };
  if (typeof user.id !== 'number' || typeof user.login !== 'string') return null;
  return { id: user.id, login: user.login };
}
