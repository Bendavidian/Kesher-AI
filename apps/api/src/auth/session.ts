import { Id, MIN_SECRET_LENGTH } from '@kesher/shared';
import { parseCookie } from 'cookie';
import type { CookieOptions, RequestHandler, Response } from 'express';
import { SignJWT, jwtVerify } from 'jose';
import { z } from 'zod';

// The web session (docs/INTERFACES.md, Auth): an HS256 JWT signed with JWT_SECRET in an httpOnly
// cookie. It is the only source of the user on every route and on the socket (principle 5). A run
// token is signed with another secret and carries another audience, so neither passes as the other.

export const SESSION_COOKIE = 'kesher_session';
export const SESSION_TTL_SECONDS = 12 * 60 * 60;
const AUDIENCE = 'kesher-web';

export const SessionClaims = z.strictObject({
  sub: Id,
  aud: z.literal(AUDIENCE),
  iat: z.int(),
  exp: z.int(),
});
export type SessionClaims = z.infer<typeof SessionClaims>;

// One message for every failure; the token is never echoed.
export class SessionError extends Error {
  constructor() {
    super('invalid session');
    this.name = 'SessionError';
  }
}

function keyOf(secret: string): Uint8Array {
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error(`JWT_SECRET must be at least ${MIN_SECRET_LENGTH} characters`);
  }
  return new TextEncoder().encode(secret);
}

// A persona's session lasts SESSION_TTL_SECONDS. A guest's ends when the guest expires
// (SPEC.md decision log, T24), so the cookie dies before the TTL monitor removes the user.
export async function signSession(
  secret: string,
  userId: string,
  now: Date = new Date(),
  expiresAt?: Date,
): Promise<string> {
  const iat = Math.floor(now.getTime() / 1000);
  const exp = expiresAt ? Math.floor(expiresAt.getTime() / 1000) : iat + SESSION_TTL_SECONDS;
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(Id.parse(userId))
    .setAudience(AUDIENCE)
    .setIssuedAt(iat)
    .setExpirationTime(exp)
    .sign(keyOf(secret));
}

// HS256 only: unsigned tokens and other algorithms fail before the claims are read.
export async function verifySession(
  secret: string,
  token: string,
  now: Date = new Date(),
): Promise<SessionClaims> {
  try {
    const { payload } = await jwtVerify(token, keyOf(secret), {
      algorithms: ['HS256'],
      audience: AUDIENCE,
      currentDate: now,
    });
    return SessionClaims.parse(payload);
  } catch {
    throw new SessionError();
  }
}

// The session token from a Cookie header, for Express requests and the Socket.IO handshake alike.
export function sessionTokenFrom(cookieHeader: string | undefined): string | undefined {
  if (!cookieHeader) return undefined;
  return parseCookie(cookieHeader)[SESSION_COOKIE] || undefined;
}

// The verified session from a Cookie header, or null when there is none or it is invalid.
export async function sessionFromCookie(
  secret: string,
  cookieHeader: string | undefined,
  now: Date = new Date(),
): Promise<SessionClaims | null> {
  const token = sessionTokenFrom(cookieHeader);
  if (!token) return null;
  try {
    return await verifySession(secret, token, now);
  } catch {
    return null;
  }
}

// The user id from a Cookie header, or null when there is no valid session.
export async function userFromCookie(
  secret: string,
  cookieHeader: string | undefined,
): Promise<string | null> {
  return (await sessionFromCookie(secret, cookieHeader))?.sub ?? null;
}

// Lax keeps the cookie off cross site POSTs; Secure outside development, where the api is http.
export function sessionCookieOptions(secure: boolean): CookieOptions {
  return { httpOnly: true, sameSite: 'lax', secure, path: '/' };
}

export function setSessionCookie(
  res: Response,
  token: string,
  secure: boolean,
  maxAgeMs: number = SESSION_TTL_SECONDS * 1000,
): void {
  res.cookie(SESSION_COOKIE, token, { ...sessionCookieOptions(secure), maxAge: maxAgeMs });
}

export function clearSessionCookie(res: Response, secure: boolean): void {
  res.clearCookie(SESSION_COOKIE, sessionCookieOptions(secure));
}

// Where a route reads the signed in user. Nothing else on the request can set it.
export interface AuthLocals {
  userId: string;
}

export function currentUser(res: Response): string {
  const { userId } = res.locals as Partial<AuthLocals>;
  if (!userId) throw new Error('currentUser called on a route without requireUser');
  return userId;
}

// 401 without a valid session cookie; otherwise the verified user id goes to res.locals.
export function requireUser(secret: string): RequestHandler {
  return async (req, res, next) => {
    const userId = await userFromCookie(secret, req.headers.cookie);
    if (!userId) {
      res.status(401).json({ error: 'sign in required' });
      return;
    }
    (res.locals as AuthLocals).userId = userId;
    next();
  };
}
