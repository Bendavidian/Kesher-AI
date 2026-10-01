import type { IngestStatus, LiveStatus } from '@kesher/shared';
import type { Db } from 'mongodb';
import { collection } from '../db/collections';
import { LIVE_EXTRACTION_DAILY_LIMIT, liveExtractionsOn } from './extractionBudget';

// What GET /ingest/status answers (docs/INTERFACES.md, REST): the answering process's own live
// ingestion, null where LIVE_INGEST is off, and from the database, which every machine shares,
// the newest live recording and the UTC day's live extractions and counters. Replay counters
// stay out; the day is the cap's day.
export async function ingestStatus(
  db: Db,
  live: LiveStatus | null,
  now: Date,
): Promise<IngestStatus> {
  const day = now.toISOString().slice(0, 10);
  const [newest] = await collection(db, 'recordings')
    .find({})
    .sort({ recordedAt: -1 })
    .limit(1)
    .toArray();
  const counters = await collection(db, 'ingest_counters')
    .find({ day, mode: 'live' })
    .sort({ reason: 1 })
    .toArray();
  return {
    live,
    lastItemAt: newest?.recordedAt ?? null,
    today: {
      day,
      extractions: { used: await liveExtractionsOn(db, day), limit: LIVE_EXTRACTION_DAILY_LIMIT },
      counters: counters.map(({ reason, count }) => ({ reason, count })),
    },
  };
}
