import { AccessionNumber, Company, ReplayResponse, ResetResponse } from '@kesher/shared';
import type { Db } from 'mongodb';
import { collection } from '../db/collections';
import { isRateLimited, MissingModelKeyError, type ModelClient } from '../llm/client';
import { toIncomingItem } from './alpaca';
import { toIncomingFiling } from './edgar';
import type { IncomingItem } from './item';
import { processItem, type ProcessDeps } from './process';
import { AlpacaNewsId, findRecording, type LiveItem } from './recordings';

// The reset and replay of one recorded item, shared by the development routes (/dev/*) and the
// demo route (/demo/replay), which map these outcomes to HTTP.

export type Provider = LiveItem['provider'];
export interface ReplayTarget {
  provider: Provider;
  externalId: string;
}

// A replay id names its provider by its shape: an Alpaca news id is digits only, an EDGAR
// accession number is 0001045810-26-000021.
export function parseSourceId(raw: string): ReplayTarget | null {
  if (AlpacaNewsId.safeParse(raw).success) return { provider: 'alpaca', externalId: raw };
  if (AccessionNumber.safeParse(raw).success) return { provider: 'sec_edgar', externalId: raw };
  return null;
}

export const describeTarget = ({ provider, externalId }: ReplayTarget) =>
  `${provider === 'alpaca' ? 'Alpaca news' : 'EDGAR filing'} ${externalId}`;

// Deletes the FeedItems of a replayed item's event and nothing else: the Source, the event and
// its extraction stay. The next replay then scores the event again with no model call and pushes
// it as a new arrival, as live ingestion would. A replay without a reset stays a duplicate.
// null when the item was never replayed.
export async function resetItem(db: Db, target: ReplayTarget): Promise<ResetResponse | null> {
  const source = await collection(db, 'sources').findOne(target);
  const event =
    source && (await collection(db, 'market_events').findOne({ sourceIds: source._id }));
  if (!source || !event) return null;
  const { deletedCount } = await collection(db, 'feed_items').deleteMany({ eventId: event._id });
  return ResetResponse.parse({ sourceId: source._id, eventId: event._id, deleted: deletedCount });
}

export interface ReplayDeps {
  models: () => ModelClient;
  log: (message: string) => void;
  onScored?: ProcessDeps['onScored'];
  embedder?: ProcessDeps['embedder'];
}

export type ReplayOutcome =
  | { kind: 'replayed'; response: ReplayResponse }
  // No committed file and no live recording, or a filing whose CIK is not a seeded company.
  | { kind: 'no_recording' }
  | { kind: 'missing_key'; message: string }
  | { kind: 'rate_limited' };

// The recording mapped the way live ingestion maps it. A filing takes its symbol and name from
// the universe company with its CIK; null when that company is not seeded.
async function incoming(db: Db, live: LiveItem): Promise<IncomingItem | null> {
  if (live.provider === 'alpaca') return toIncomingItem(live.item);
  const company = await collection(db, 'companies').findOne({ cik: live.item.cik });
  return company ? toIncomingFiling(live.item, Company.parse(company)) : null;
}

// Replays one recorded item by its provider id, never by keyword, through the same pipeline as
// live items: pre filter, injection screen, extraction. The committed recording file is read
// first, then the live recordings collection. A missing model key or rate limited providers
// leave the item stored without an extraction; it resumes on the next replay.
export async function replayItem(
  db: Db,
  target: ReplayTarget,
  { models, log, onScored, embedder }: ReplayDeps,
): Promise<ReplayOutcome> {
  const recording = await findRecording(db, target.provider, target.externalId);
  const item = recording && (await incoming(db, recording));
  if (!item) return { kind: 'no_recording' };
  try {
    const result = await processItem(db, item, {
      mode: 'replay',
      models,
      log,
      ...(onScored ? { onScored } : {}),
      ...(embedder ? { embedder } : {}),
    });
    return { kind: 'replayed', response: ReplayResponse.parse(result) };
  } catch (error) {
    if (error instanceof MissingModelKeyError)
      return { kind: 'missing_key', message: error.message };
    if (isRateLimited(error)) return { kind: 'rate_limited' };
    throw error;
  }
}
