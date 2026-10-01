import { GuestPortfolioRequest } from '@kesher/shared';
import express, { Router, type ErrorRequestHandler, type Response } from 'express';
import type { Db } from 'mongodb';
import { currentUser, requireUser, setSessionCookie, signSession } from '../auth/session';
import { changeGuestPortfolio, createGuest } from '../guest/guest';
import { clientKey, createRateLimiter, type RateTake } from '../guest/rateLimit';
import { toPublicUser, type AuthOptions } from './auth';

const HOUR_MS = 60 * 60 * 1000;
// Per client IP, per hour (SPEC.md decision log, T24).
export const GUEST_CREATE_LIMIT = 5;
// Per guest, per hour.
export const GUEST_CHANGE_LIMIT = 20;

export interface GuestOptions {
  // The clock of expiresAt, the scoring and the limiters. For tests.
  now?: () => number;
  createLimit?: number;
  changeLimit?: number;
}

const BAD_REQUEST = { error: 'choose 1 to 6 different companies from the universe' };

const onBadJson: ErrorRequestHandler = (error: { type?: string }, _req, res, next) => {
  if (error.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'invalid json' });
    return;
  }
  next(error);
};

function refuse(res: Response, take: Extract<RateTake, { ok: false }>, error: string): void {
  res.set('Retry-After', String(take.retryAfterSeconds));
  res.status(429).json({ error });
}

// POST /guest and PUT /guest/portfolio (docs/INTERFACES.md, REST). POST /guest creates a guest
// from the picked companies and signs it in; like login it needs no session. The guest's identity
// is then the session cookie only, as for a persona.
export function guestRouter(
  db: Db,
  { secret, secureCookie }: AuthOptions,
  {
    now = Date.now,
    createLimit = GUEST_CREATE_LIMIT,
    changeLimit = GUEST_CHANGE_LIMIT,
  }: GuestOptions = {},
): Router {
  const router = Router();
  const creates = createRateLimiter({ limit: createLimit, windowMs: HOUR_MS, now });
  const changes = createRateLimiter({ limit: changeLimit, windowMs: HOUR_MS, now });
  const json = express.json({ limit: '2kb' });
  // One change at a time per guest, so the items never end scored against older holdings.
  const changing = new Set<string>();

  router.post('/guest', json, async (req, res) => {
    const body = GuestPortfolioRequest.safeParse(req.body);
    if (!body.success) {
      res.status(400).json(BAD_REQUEST);
      return;
    }
    // req.ip is the client behind the host's proxy when the app trusts it (trustProxy).
    const key = clientKey(req.ip);
    const take = creates.take(key);
    if (!take.ok) {
      refuse(res, take, 'Too many guest portfolios from this address. Try again later.');
      return;
    }
    const at = new Date(now());
    // Only a guest that was created counts against the address.
    const created = await createGuest(db, body.data.symbols, at).catch((error: unknown) => {
      creates.refund(key);
      throw error;
    });
    if (created.outcome === 'full') {
      creates.refund(key);
      res.status(503).json({
        error: 'Too many guest portfolios right now. Try again later, or view a persona.',
      });
      return;
    }
    const { user } = created;
    const expiresAt = user.expiresAt!;
    setSessionCookie(
      res,
      await signSession(secret, user._id, at, expiresAt),
      secureCookie,
      expiresAt.getTime() - at.getTime(),
    );
    res.status(201).json(toPublicUser(user));
  });

  router.put('/guest/portfolio', requireUser(secret), json, async (req, res) => {
    const body = GuestPortfolioRequest.safeParse(req.body);
    if (!body.success) {
      res.status(400).json(BAD_REQUEST);
      return;
    }
    const userId = currentUser(res);
    if (changing.has(userId)) {
      res.status(409).json({ error: 'a portfolio change is already running' });
      return;
    }
    const take = changes.take(userId);
    if (!take.ok) {
      refuse(res, take, 'Too many portfolio changes. Try again later.');
      return;
    }
    changing.add(userId);
    let changed;
    try {
      changed = await changeGuestPortfolio(db, userId, body.data.symbols, new Date(now()));
    } finally {
      changing.delete(userId);
    }
    if (changed.outcome === 'not_guest') {
      res.status(403).json({ error: "a persona's holdings never change" });
      return;
    }
    if (changed.outcome === 'gone') {
      res.status(401).json({ error: 'sign in required' });
      return;
    }
    res.json(toPublicUser(changed.user));
  });
  router.use('/guest', onBadJson);

  return router;
}
