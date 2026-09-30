import { randomUUID } from 'node:crypto';
import { GUEST_TTL_MS, User, type UniverseSymbol } from '@kesher/shared';
import type { Db } from 'mongodb';
import { collection } from '../db/collections';
import { scoreUser } from '../relevance/feed';

// Guest portfolios on the public instance (SPEC.md decision log, T24). A guest is a User like
// the personas, with holdings a visitor picked and an expiresAt that the TTL indexes act on.

// Guests alive at once. Past it, POST /guest answers 503 until some expire.
export const MAX_LIVE_GUESTS = 200;

// No password matches it: verifyPassword accepts only the scrypt format, and login refuses a
// guest anyway. A guest is signed in only by the cookie POST /guest sets.
const NO_PASSWORD = 'none$guest';

export const GUEST_DISPLAY_NAME = 'Your portfolio';

// Holdings store quantities; a guest picks companies only.
const holdingsOf = (symbols: readonly UniverseSymbol[]) =>
  symbols.map((symbol) => ({ symbol, quantity: 1 }));

export type CreateGuest = { outcome: 'created'; user: User } | { outcome: 'full' };

// Creates the guest, then scores every stored event for it with no model call, so its feed is
// full before the cookie is set. A failed backfill removes the guest again.
export async function createGuest(
  db: Db,
  symbols: readonly UniverseSymbol[],
  now: Date,
): Promise<CreateGuest> {
  const users = collection(db, 'users');
  // Not atomic with the insert: concurrent requests may pass the cap by a few.
  const live = await users.countDocuments({ expiresAt: { $gt: now } });
  if (live >= MAX_LIVE_GUESTS) return { outcome: 'full' };

  const _id = randomUUID();
  const user = User.parse({
    _id,
    email: `guest-${_id}@guest.invalid`,
    passwordHash: NO_PASSWORD,
    displayName: GUEST_DISPLAY_NAME,
    holdings: holdingsOf(symbols),
    interests: [],
    createdAt: now,
    expiresAt: new Date(now.getTime() + GUEST_TTL_MS),
  });
  await users.insertOne(user);
  try {
    await scoreUser(db, user, now);
  } catch (error) {
    await Promise.all([
      users.deleteOne({ _id }),
      collection(db, 'feed_items').deleteMany({ userId: _id }),
    ]).catch(() => undefined);
    throw error;
  }
  return { outcome: 'created', user };
}

export type ChangePortfolio =
  { outcome: 'changed'; user: User } | { outcome: 'not_guest' } | { outcome: 'gone' };

// New holdings for a live guest, then every event rescored in place: relevance and path change,
// the research state stays. A persona's holdings never change.
export async function changeGuestPortfolio(
  db: Db,
  userId: string,
  symbols: readonly UniverseSymbol[],
  now: Date,
): Promise<ChangePortfolio> {
  const users = collection(db, 'users');
  const changed = await users.findOneAndUpdate(
    { _id: userId, expiresAt: { $gt: now } },
    { $set: { holdings: holdingsOf(symbols) } },
    { returnDocument: 'after' },
  );
  if (!changed) {
    const user = await users.findOne({ _id: userId }, { projection: { expiresAt: 1 } });
    return { outcome: user && !user.expiresAt ? 'not_guest' : 'gone' };
  }
  const user = User.parse(changed);
  await scoreUser(db, user, now);
  return { outcome: 'changed', user };
}
