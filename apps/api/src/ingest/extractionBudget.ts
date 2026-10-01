import { randomUUID } from 'node:crypto';
import type { Db } from 'mongodb';
import { collection } from '../db/collections';
import { retryOnDuplicateKey } from '../db/retry';

// The daily cap on live news extractions (SPEC.md decision log, T19). Groq's free tier gives
// 200,000 tokens a day and a median extraction takes 812 (docs/EVALS.md), so 150 live items use
// at least about 122,000; an item whose answer fails the schema can take up to three calls, so
// that is a floor. The rest stays for the verifier and replays before calls fall back to Gemini,
// which research also uses. Filings, replay, the demo library and Investigate never reserve
// here. Live ingestion reserves once per item, whatever its retries. One document per UTC day, shared by every machine on the database, like the
// research budget (research/dailyBudget.ts).
export const LIVE_EXTRACTION_DAILY_LIMIT = 150;

// extractions is the day's count after this reservation, or the count that refused it.
export interface ExtractionReservation {
  reserved: boolean;
  extractions: number;
  limit: number;
}

// Reserves one live extraction for today (UTC) when fewer than limit are reserved. The
// conditional $inc is atomic, so concurrent items never pass the limit. A reserved extraction
// stays counted even if the item fails afterwards.
export async function reserveLiveExtraction(
  db: Db,
  now: Date,
  limit = LIVE_EXTRACTION_DAILY_LIMIT,
): Promise<ExtractionReservation> {
  const day = now.toISOString().slice(0, 10);
  const budget = collection(db, 'ingest_budget');
  await retryOnDuplicateKey(() =>
    budget.updateOne(
      { day },
      { $setOnInsert: { _id: randomUUID(), day, extractions: 0, updatedAt: now } },
      { upsert: true },
    ),
  );
  const reserved = await budget.findOneAndUpdate(
    { day, extractions: { $lt: limit } },
    { $inc: { extractions: 1 }, $set: { updatedAt: now } },
    { returnDocument: 'after' },
  );
  if (reserved) return { reserved: true, extractions: reserved.extractions, limit };
  const spent = await budget.findOne({ day });
  return { reserved: false, extractions: spent?.extractions ?? limit, limit };
}

// The live extractions reserved on a UTC day, 0 when none.
export async function liveExtractionsOn(db: Db, day: string): Promise<number> {
  return (await collection(db, 'ingest_budget').findOne({ day }))?.extractions ?? 0;
}
