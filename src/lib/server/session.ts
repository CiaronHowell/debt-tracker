import { createHmac, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'dt_session';
export const OAUTH_STATE_COOKIE = 'dt_oauth_state';
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export interface Session {
  githubId: number;
  login: string;
  /** Expiry as Unix seconds. */
  exp: number;
}

function sign(data: string, secret: string): string {
  return createHmac('sha256', secret).update(data).digest('base64url');
}

export function createSessionToken(session: Session, secret: string): string {
  const data = Buffer.from(JSON.stringify(session)).toString('base64url');
  return `${data}.${sign(data, secret)}`;
}

export function verifySessionToken(
  token: string | undefined,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): Session | null {
  if (!token) return null;
  const [data, signature, ...rest] = token.split('.');
  if (!data || !signature || rest.length) return null;

  const expected = Buffer.from(sign(data, secret));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;

  try {
    const value: unknown = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
    if (typeof value !== 'object' || value === null) return null;
    const { githubId, login, exp } = value as Record<string, unknown>;
    if (typeof githubId !== 'number' || typeof login !== 'string' || typeof exp !== 'number') {
      return null;
    }
    if (exp <= nowSeconds) return null;
    return { githubId, login, exp };
  } catch {
    return null;
  }
}

export function isOwner(session: Session | null, allowedGithubId: string): session is Session {
  return session !== null && allowedGithubId !== '' && String(session.githubId) === allowedGithubId;
}
