import { describe, expect, it } from 'vitest';
import { createSessionToken, isOwner, verifySessionToken } from './session';

const SECRET = 'a'.repeat(32);
const NOW = 1_800_000_000;
const session = { githubId: 42, login: 'owner', exp: NOW + 60 };

describe('session tokens', () => {
  it('round-trips a signed session', () => {
    const token = createSessionToken(session, SECRET);
    expect(verifySessionToken(token, SECRET, NOW)).toEqual(session);
  });

  it('rejects a missing, malformed, or differently signed token', () => {
    const token = createSessionToken(session, SECRET);
    expect(verifySessionToken(undefined, SECRET, NOW)).toBeNull();
    expect(verifySessionToken('not-a-token', SECRET, NOW)).toBeNull();
    expect(verifySessionToken(`${token}.extra`, SECRET, NOW)).toBeNull();
    expect(verifySessionToken(token, 'b'.repeat(32), NOW)).toBeNull();
  });

  it('rejects a tampered payload', () => {
    const [, signature] = createSessionToken(session, SECRET).split('.');
    const forged = Buffer.from(JSON.stringify({ ...session, githubId: 7 })).toString('base64url');
    expect(verifySessionToken(`${forged}.${signature}`, SECRET, NOW)).toBeNull();
  });

  it('rejects an expired session', () => {
    const token = createSessionToken(session, SECRET);
    expect(verifySessionToken(token, SECRET, session.exp)).toBeNull();
  });

  it('only treats the allowlisted GitHub id as the owner', () => {
    expect(isOwner(session, '42')).toBe(true);
    expect(isOwner(session, '43')).toBe(false);
    expect(isOwner(session, '')).toBe(false);
    expect(isOwner(null, '42')).toBe(false);
  });
});
