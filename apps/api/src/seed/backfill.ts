import type { Db } from 'mongodb';
import { toIncomingItem } from '../ingest/alpaca';
import { RECORDINGS_DIR, loadRecording } from '../ingest/recordings';

// Schema migration for T05, which added Source.publisher. Sources stored before it lack the
// field and fail the strict schema. Alpaca items take the publisher from their recording, and
// anything else, or an item without a recording, gets null. Only a missing field is written, so
// a stored value is never replaced and a rerun changes nothing. The seed has already set null on
// its own filings. A malformed recording throws and stops the seed (fail closed); fix the file.
export async function backfillPublishers(db: Db, dir = RECORDINGS_DIR): Promise<number> {
  // Only the fields read here: these documents do not match the current Source schema yet.
  const sources = db.collection<{ _id: string; provider: string; externalId: string }>('sources');
  const missing = await sources
    .find({ publisher: { $exists: false } }, { projection: { _id: 1, provider: 1, externalId: 1 } })
    .toArray();
  let updated = 0;
  for (const source of missing) {
    const recording =
      source.provider === 'alpaca' ? await loadRecording(source.externalId, dir) : null;
    const publisher = recording ? toIncomingItem(recording.item).publisher : null;
    const result = await sources.updateOne(
      { _id: source._id, publisher: { $exists: false } },
      { $set: { publisher } },
    );
    updated += result.modifiedCount;
  }
  return updated;
}
