import { randomUUID } from 'node:crypto';
import { mintRunToken } from '@kesher/mcp';
import { SignJWT, UnsecuredJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  SessionError,
  sessionTokenFrom,
  signSession,
  userFromCookie,
  verifySession,
} from './session';

const SECRET = 'test-session-secret-at-least-32-chars';
const userId = randomUUID();
const at = new Date('2026-09-28T12:00:00Z');
const later = (seconds: number) => new Date(at.getTime() + seconds * 1000);

async function signRaw(payload: Record<string, unknown>, secret = SECRET): Promise<string> {
  const iat = Math.floor(at.getTime() / 1000);
  return new SignJWT({ iat, exp: iat + SESSION_TTL_SECONDS, aud: 'kesher-web', ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .sign(new TextEncoder().encode(secret));
}

describe('session token', () => {
  it('round trips the user with a 12 hour lifetime', async () => {
    const token = await signSession(SECRET, userId, at);
    const claims = await verifySession(SECRET, token, later(60));
    expect(claims.sub).toBe(userId);
    expect(claims.exp - claims.iat).toBe(SESSION_TTL_SECONDS);
  });

  it('rejects another secret, an expired token and a changed signature', async () => {
    const token = await signSession(SECRET, userId, at);
    await expect(
      verifySession('another-secret-that-is-at-least-32-chars', token, at),
    ).rejects.toBeInstanceOf(SessionError);
    await expect(verifySession(SECRET, token, later(SESSION_TTL_SECONDS + 1))).rejects.toThrow(
      SessionError,
    );
    const [header, payload, signature] = token.split('.');
    const flipped = `${signature!.startsWith('A') ? 'B' : 'A'}${signature!.slice(1)}`;
    await expect(verifySession(SECRET, `${header}.${payload}.${flipped}`, at)).rejects.toThrow(
      SessionError,
    );
  });

  it('rejects an unsigned token', async () => {
    const unsigned = new UnsecuredJWT({ aud: 'kesher-web' })
      .setSubject(userId)
      .setIssuedAt()
      .setExpirationTime('1h')
      .encode();
    await expect(verifySession(SECRET, unsigned)).rejects.toThrow(SessionError);
  });

  it('rejects a run token, even one signed with the same secret', async () => {
    const runToken = await mintRunToken(SECRET, {
      userId,
      agent: 'research',
      tools: ['get_event'],
    });
    await expect(verifySession(SECRET, runToken)).rejects.toThrow(SessionError);
  });

  it('rejects wrong claims: a subject that is not an id, or extra claims', async () => {
    await expect(verifySession(SECRET, await signRaw({ sub: 'persona-a' }), at)).rejects.toThrow(
      SessionError,
    );
    await expect(
      verifySession(SECRET, await signRaw({ sub: userId, userId: randomUUID() }), at),
    ).rejects.toThrow(SessionError);
  });

  it('never puts the token in the error', async () => {
    const token = await signSession(SECRET, userId, at);
    const error = await verifySession(SECRET, token, later(SESSION_TTL_SECONDS + 1)).catch(
      (e: unknown) => e,
    );
    expect(String(error)).not.toContain(token);
  });

  it('refuses a short secret', async () => {
    await expect(signSession('short', userId)).rejects.toThrow('at least 32');
  });
});

describe('session cookie', () => {
  it('reads the session cookie among others', async () => {
    const token = await signSession(SECRET, userId);
    expect(sessionTokenFrom(`a=1; ${SESSION_COOKIE}=${token}; b=2`)).toBe(token);
    expect(sessionTokenFrom('a=1')).toBeUndefined();
    expect(sessionTokenFrom(undefined)).toBeUndefined();
  });

  it('gives the user for a valid cookie and null otherwise', async () => {
    const token = await signSession(SECRET, userId);
    expect(await userFromCookie(SECRET, `${SESSION_COOKIE}=${token}`)).toBe(userId);
    expect(await userFromCookie(SECRET, `${SESSION_COOKIE}=garbage`)).toBeNull();
    expect(await userFromCookie(SECRET, undefined)).toBeNull();
  });
});
