import { randomUUID } from 'node:crypto';
import type { AgentRun } from '@kesher/shared';
import type { Db } from 'mongodb';
import { collection } from '../db/collections';
import { retryOnDuplicateKey } from '../db/retry';

// The daily budget of the research gate (SPEC.md decision log, T12): research runs per UTC day,
// automatic and Investigate together, counted in one document per day that every machine on the
// database shares. 30 runs keep a worst case deep run (16 model calls) inside Gemini's 500
// requests a day. Automatic runs stop at 20, so at least 10 stay for Investigate. T16 tunes both.
export const DAILY_RUN_LIMIT = 30;
export const AUTO_RUN_LIMIT = 20;
// Guests together, at most 10 a day and one per guest per UTC day (SPEC.md decision log, T24).
// A guest's run also stops at AUTO_RUN_LIMIT, like an automatic one, and counts toward it, so the
// last 10 of the day's runs always stay for the personas' Investigate.
export const GUEST_RUN_LIMIT = 10;

export const RUN_LIMIT: Record<AgentRun['trigger'], number> = {
  gate: AUTO_RUN_LIMIT,
  investigate: DAILY_RUN_LIMIT,
};

// runs is the day's count after this reservation, or the count that refused it. scope names the
// limit that refused a guest's run: the guests' share of the day (guests; runs and limit are the
// guests' when GUEST_RUN_LIMIT refused it, the day's when AUTO_RUN_LIMIT did), or this guest's
// one run today (guest).
export interface Reservation {
  reserved: boolean;
  runs: number;
  limit: number;
  scope?: 'guests' | 'guest';
  // For a guest's run: the guests' runs today after this reservation.
  guestRuns?: number;
}

const dayOf = (now: Date) => now.toISOString().slice(0, 10);

// Reserves one run for today (UTC) when fewer than the trigger's limit are reserved. The
// conditional $inc is atomic, so concurrent requests never pass the limit. A reserved run stays
// counted even if it never starts, for example after a reset in between.
// A guest's run also counts against GUEST_RUN_LIMIT, in the same document and the same $inc.
export async function reserveRun(
  db: Db,
  trigger: AgentRun['trigger'],
  now: Date,
  { guest = false }: { guest?: boolean } = {},
): Promise<Reservation> {
  const day = dayOf(now);
  const limit = guest ? AUTO_RUN_LIMIT : RUN_LIMIT[trigger];
  const budget = collection(db, 'research_budget');
  await retryOnDuplicateKey(() =>
    budget.updateOne(
      { day },
      { $setOnInsert: { _id: randomUUID(), day, runs: 0, updatedAt: now } },
      { upsert: true },
    ),
  );
  // A day stored before T24 has no guestRuns, which $not $gte matches as none.
  const reserved = await budget.findOneAndUpdate(
    guest
      ? { day, runs: { $lt: limit }, guestRuns: { $not: { $gte: GUEST_RUN_LIMIT } } }
      : { day, runs: { $lt: limit } },
    { $inc: guest ? { runs: 1, guestRuns: 1 } : { runs: 1 }, $set: { updatedAt: now } },
    { returnDocument: 'after' },
  );
  if (reserved) {
    return guest
      ? { reserved: true, runs: reserved.runs, limit, guestRuns: reserved.guestRuns ?? 0 }
      : { reserved: true, runs: reserved.runs, limit };
  }
  const spent = await budget.findOne({ day });
  const runs = spent?.runs ?? limit;
  if (!guest) return { reserved: false, runs, limit };
  const guestRuns = spent?.guestRuns ?? 0;
  return guestRuns >= GUEST_RUN_LIMIT
    ? { reserved: false, runs: guestRuns, limit: GUEST_RUN_LIMIT, scope: 'guests' }
    : { reserved: false, runs, limit, scope: 'guests' };
}

// Investigate for a guest: first the guest's one run today, claimed atomically on the user, then
// a run from the shared budget. When the budget refuses, the guest's day is given back.
export async function reserveGuestRun(db: Db, userId: string, now: Date): Promise<Reservation> {
  const day = dayOf(now);
  const users = collection(db, 'users');
  const before = await users.findOneAndUpdate(
    { _id: userId, expiresAt: { $gt: now }, investigatedOn: { $ne: day } },
    { $set: { investigatedOn: day } },
    { returnDocument: 'before', projection: { investigatedOn: 1 } },
  );
  if (!before) return { reserved: false, runs: 1, limit: 1, scope: 'guest' };
  const giveBack = () =>
    users.updateOne(
      { _id: userId, investigatedOn: day },
      before.investigatedOn
        ? { $set: { investigatedOn: before.investigatedOn } }
        : { $unset: { investigatedOn: '' } },
    );
  let reservation: Reservation;
  try {
    reservation = await reserveRun(db, 'investigate', now, { guest: true });
  } catch (error) {
    await giveBack().catch(() => undefined);
    throw error;
  }
  if (!reservation.reserved) await giveBack();
  return reservation;
}
