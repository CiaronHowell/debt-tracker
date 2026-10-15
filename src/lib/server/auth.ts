import { error, type Cookies, type RequestEvent } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import {
  isOwner,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  createSessionToken,
  verifySessionToken,
  type Session
} from './session';

export interface ServerConfig {
  githubClientId: string;
  githubClientSecret: string;
  allowedGithubId: string;
  sessionSecret: string;
  blobToken: string;
}

export function serverConfig(): ServerConfig {
  const config = {
    githubClientId: env.GITHUB_CLIENT_ID ?? '',
    githubClientSecret: env.GITHUB_CLIENT_SECRET ?? '',
    allowedGithubId: env.GITHUB_ALLOWED_USER_ID ?? '',
    sessionSecret: env.SESSION_SECRET ?? '',
    blobToken: env.BLOB_READ_WRITE_TOKEN ?? ''
  };
  const missing = Object.entries(config)
    .filter(([, value]) => value === '')
    .map(([key]) => key);
  if (missing.length) error(503, 'Owner sync is not configured on this deployment.');
  if (config.sessionSecret.length < 32)
    error(503, 'SESSION_SECRET must be at least 32 characters.');
  return config;
}

export function readOwnerSession(cookies: Cookies, config: ServerConfig): Session | null {
  const session = verifySessionToken(cookies.get(SESSION_COOKIE), config.sessionSecret);
  return isOwner(session, config.allowedGithubId) ? session : null;
}

export function setSessionCookie(
  cookies: Cookies,
  session: Omit<Session, 'exp'>,
  config: ServerConfig
): void {
  const exp = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS;
  cookies.set(SESSION_COOKIE, createSessionToken({ ...session, exp }, config.sessionSecret), {
    path: '/',
    // `secure` is left to SvelteKit's default: on everywhere except http://localhost.
    httpOnly: true,
    sameSite: 'lax',
    maxAge: SESSION_MAX_AGE_SECONDS
  });
}

export function clearSessionCookie(cookies: Cookies): void {
  cookies.delete(SESSION_COOKIE, { path: '/' });
}

/** Rejects anything but the allowlisted owner, and non-JSON writes (CSRF guard). */
export function requireOwner(event: RequestEvent): { session: Session; config: ServerConfig } {
  const config = serverConfig();
  if (event.request.method !== 'GET') {
    const contentType = event.request.headers.get('content-type') ?? '';
    if (!contentType.startsWith('application/json')) error(415, 'Expected application/json.');
  }
  const session = readOwnerSession(event.cookies, config);
  if (!session) error(401, 'Sign in required.');
  return { session, config };
}
