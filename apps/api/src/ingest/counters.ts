import { randomUUID } from 'node:crypto';
import type { DropReason, IngestMode } from '@kesher/shared';
import type { Db } from 'mongodb';
import { collection } from '../db/collections';
import { retryOnDuplicateKey } from '../db/retry';

// Adds one to the counter for this UTC day, mode and reason, so the savings of the pre filter
// show in the metrics (SPEC.md Pipeline). The dropped item itself is never stored.
export async function countDrop(
  db: Db,
  reason: DropReason,
  mode: IngestMode,
  now: Date,
): Promise<void> {
  const day = now.toISOString().slice(0, 10);
  const counters = collection(db, 'ingest_counters');
  const increment = () =>
    counters.updateOne(
      { day, mode, reason },
      { $inc: { count: 1 }, $set: { updatedAt: now }, $setOnInsert: { _id: randomUUID() } },
      { upsert: true },
    );
  await retryOnDuplicateKey(increment);
}
