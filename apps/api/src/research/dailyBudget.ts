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

export const RUN_LIMIT: Record<AgentRun['trigger'], number> = {
  gate: AUTO_RUN_LIMIT,
  investigate: DAILY_RUN_LIMIT,
};

// runs is the day's count after this reservation, or the count that refused it.
export interface Reservation {
  reserved: boolean;
  runs: number;
  limit: number;
}

// Reserves one run for today (UTC) when fewer than the trigger's limit are reserved. The
// conditional $inc is atomic, so concurrent requests never pass the limit. A reserved run stays
// counted even if it never starts, for example after a reset in between.
export async function reserveRun(
  db: Db,
  trigger: AgentRun['trigger'],
  now: Date,
): Promise<Reservation> {
  const day = now.toISOString().slice(0, 10);
  const limit = RUN_LIMIT[trigger];
  const budget = collection(db, 'research_budget');
  await retryOnDuplicateKey(() =>
    budget.updateOne(
      { day },
      { $setOnInsert: { _id: randomUUID(), day, runs: 0, updatedAt: now } },
      { upsert: true },
    ),
  );
  const reserved = await budget.findOneAndUpdate(
    { day, runs: { $lt: limit } },
    { $inc: { runs: 1 }, $set: { updatedAt: now } },
    { returnDocument: 'after' },
  );
  if (reserved) return { reserved: true, runs: reserved.runs, limit };
  const spent = await budget.findOne({ day });
  return { reserved: false, runs: spent?.runs ?? limit, limit };
}
