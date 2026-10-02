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

export type DeleteGuest = { outcome: 'deleted' } | { outcome: 'not_guest' } | { outcome: 'gone' };

// Removes a guest before its 24 hours are up, with everything stored for it: its feed items, its
// research runs, their reports and their claims (SPEC.md decision log, T29). A persona is never
// removed. The user goes first, so a research job that starts from now on finds it gone and is
// skipped. Anything written for the guest after that, by a run already going or a scoring run
// that had read the guest, carries the guest's expiresAt and is removed by the TTL indexes, as is
// whatever a failed cleanup leaves: the guest is gone once its User is, and the error is only
// logged.
export async function deleteGuest(
  db: Db,
  userId: string,
  logError: (error: unknown) => void = () => undefined,
): Promise<DeleteGuest> {
  const users = collection(db, 'users');
  const user = await users.findOne({ _id: userId }, { projection: { expiresAt: 1 } });
  if (!user) return { outcome: 'gone' };
  if (!user.expiresAt) return { outcome: 'not_guest' };
  const { deletedCount } = await users.deleteOne({ _id: userId, expiresAt: { $exists: true } });
  // The TTL monitor got there first.
  if (deletedCount === 0) return { outcome: 'gone' };

  try {
    const runs = collection(db, 'agent_runs');
    const reports = collection(db, 'reports');
    const runIds = (await runs.find({ userId }, { projection: { _id: 1 } }).toArray()).map(
      (run) => run._id,
    );
    const reportIds = (
      await reports.find({ runId: { $in: runIds } }, { projection: { _id: 1 } }).toArray()
    ).map((report) => report._id);
    await collection(db, 'claims').deleteMany({ reportId: { $in: reportIds } });
    await reports.deleteMany({ _id: { $in: reportIds } });
    await runs.deleteMany({ userId });
    await collection(db, 'feed_items').deleteMany({ userId });
  } catch (error) {
    logError(
      new Error(`guest ${userId} removed; its documents are left to the TTL`, { cause: error }),
    );
  }
  return { outcome: 'deleted' };
}
