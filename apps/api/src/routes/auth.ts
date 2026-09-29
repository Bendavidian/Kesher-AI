import { LoginRequest, PublicUser, type User } from '@kesher/shared';
import express, { Router, type ErrorRequestHandler } from 'express';
import type { Db } from 'mongodb';
import { hashPassword, verifyPassword } from '../auth/password';
import {
  clearSessionCookie,
  currentUser,
  requireUser,
  setSessionCookie,
  signSession,
  userFromCookie,
} from '../auth/session';
import { collection } from '../db/collections';

export interface AuthOptions {
  // JWT_SECRET: signs and verifies the session cookie.
  secret: string;
  // Secure cookies everywhere except local development over http.
  secureCookie: boolean;
  // Told when a signed in user signs out, so their open sockets close.
  onSignOut?: (userId: string) => void;
}

export const toPublicUser = (user: User): PublicUser =>
  PublicUser.parse({
    _id: user._id,
    email: user.email,
    displayName: user.displayName,
    holdings: user.holdings,
    interests: user.interests,
  });

const LOGIN_FAILED = { error: 'email or password is wrong' };

// Compared against when the email is unknown, so both failures take the same time.
let decoyHash: Promise<string> | undefined;

const onBadJson: ErrorRequestHandler = (error: { type?: string }, _req, res, next) => {
  if (error.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'invalid json' });
    return;
  }
  next(error);
};

// POST /auth/login, POST /auth/logout and GET /me (docs/INTERFACES.md, Auth). The persona switcher
// signs in as a seeded user with the public demo password; the cookie is the only identity.
export function authRouter(db: Db, { secret, secureCookie, onSignOut }: AuthOptions): Router {
  const router = Router();
  const users = collection(db, 'users');

  router.post('/auth/login', express.json({ limit: '10kb' }), async (req, res) => {
    const body = LoginRequest.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: 'email and password are required' });
      return;
    }
    const user = await users.findOne({ email: body.data.email });
    const stored = user?.passwordHash ?? (await (decoyHash ??= hashPassword('decoy')));
    const valid = await verifyPassword(body.data.password, stored);
    if (!user || !valid) {
      res.status(401).json(LOGIN_FAILED);
      return;
    }
    setSessionCookie(res, await signSession(secret, user._id), secureCookie);
    res.json(toPublicUser(user));
  });
  router.use('/auth/login', onBadJson);

  router.post('/auth/logout', async (req, res) => {
    const userId = await userFromCookie(secret, req.headers.cookie);
    if (userId) onSignOut?.(userId);
    clearSessionCookie(res, secureCookie);
    res.status(204).end();
  });

  router.get('/me', requireUser(secret), async (_req, res) => {
    const user = await users.findOne({ _id: currentUser(res) });
    if (!user) {
      // A valid cookie for a user that is gone: sign out.
      clearSessionCookie(res, secureCookie);
      res.status(401).json({ error: 'sign in required' });
      return;
    }
    res.json(toPublicUser(user));
  });

  return router;
}
