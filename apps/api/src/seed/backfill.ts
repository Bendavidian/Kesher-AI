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

// Schema migration for T08 part 2, which added FeedItem.research.reportId. Items stored before it
// lack the field and fail the strict schema. They were never researched, so null is right. Only a
// missing field is written, so a rerun changes nothing.
export async function backfillResearchReports(db: Db): Promise<number> {
  const items = db.collection<{ _id: string }>('feed_items');
  const result = await items.updateMany(
    { 'research.reportId': { $exists: false } },
    { $set: { 'research.reportId': null } },
  );
  return result.modifiedCount;
}

// Schema migration for T14, which added AgentRun.verification and Claim.figures on metrics. Runs
// stored before it never verified, so null is right; a metric stored before it had no figures
// checked, so it stays unverified with none. Only a missing field is written, so a rerun changes
// nothing. Returns the runs and the claims it changed.
export async function backfillVerification(db: Db): Promise<{ runs: number; claims: number }> {
  const runs = await db
    .collection<{ _id: string }>('agent_runs')
    .updateMany({ verification: { $exists: false } }, { $set: { verification: null } });
  const claims = await db
    .collection<{ _id: string }>('claims')
    .updateMany({ type: 'metric', figures: { $exists: false } }, { $set: { figures: [] } });
  return { runs: runs.modifiedCount, claims: claims.modifiedCount };
}

// Schema migration for T20, which added Claim.origin and Report.omitted. Every claim stored before
// it came from the model, and code left nothing out of those reports, since it wrote nothing.
// Only a missing field is written, so a rerun changes nothing. Returns the claims and the reports
// it changed.
export async function backfillReportCore(db: Db): Promise<{ claims: number; reports: number }> {
  const claims = await db
    .collection<{ _id: string }>('claims')
    .updateMany({ origin: { $exists: false } }, { $set: { origin: 'model' } });
  const reports = await db
    .collection<{ _id: string }>('reports')
    .updateMany({ omitted: { $exists: false } }, { $set: { omitted: [] } });
  return { claims: claims.modifiedCount, reports: reports.modifiedCount };
}
