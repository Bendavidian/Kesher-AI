import { randomUUID } from 'node:crypto';
import { MarketEvent, Source, type EventStatus, type Tier } from '@kesher/shared';
import { MongoServerError, type Db } from 'mongodb';
import { collection } from '../db/collections';
import type { IncomingItem } from './item';

const DUPLICATE_KEY = 11000;

export interface IngestResult {
  sourceId: string;
  eventId: string;
  sourceCreated: boolean;
  eventCreated: boolean;
}

// Tier 3 items (X posts, V2) start unconfirmed; primary sources and wires are confirmed.
export function initialStatus(tier: Tier): EventStatus {
  return tier === 3 ? 'unconfirmed' : 'confirmed';
}

// Stores the Source, then its MarketEvent. processItem (process.ts) runs the pre filter first
// and is the single entry for every item, replayed or live. Deterministic code only. A second
// call with the same item creates nothing: the Source is upserted on provider and externalId,
// and the event is found by its source id. Every Source field is written only on insert, so the
// stored text always matches its injection screen and extraction; an update from the provider
// is logged and counted by processItem, never written.
export async function ingestItem(
  db: Db,
  item: IncomingItem,
  now = new Date(),
): Promise<IngestResult> {
  const candidate = Source.parse({
    _id: randomUUID(),
    ...item,
    injectionScreen: null,
    createdAt: now,
  });
  const { provider, externalId, ...insertFields } = candidate;
  const sources = collection(db, 'sources');
  const upsertSource = () =>
    sources.findOneAndUpdate(
      { provider, externalId },
      { $setOnInsert: insertFields },
      { upsert: true, returnDocument: 'after', includeResultMetadata: true },
    );
  // Concurrent first upserts of one key can fail with E11000 (MongoDB upsert caveat). The
  // retry then matches the Source the other call inserted.
  const upserted = await upsertSource().catch((error: unknown) => {
    if (error instanceof MongoServerError && error.code === DUPLICATE_KEY) return upsertSource();
    throw error;
  });
  const source = Source.parse(upserted.value);
  const sourceCreated = upserted.lastErrorObject?.updatedExisting === false;

  const events = collection(db, 'market_events');
  const existing = await events.findOne({ sourceIds: source._id });
  if (existing) {
    return { sourceId: source._id, eventId: existing._id, sourceCreated, eventCreated: false };
  }
  const event = MarketEvent.parse({
    _id: randomUUID(),
    sourceIds: [source._id],
    headline: source.title,
    publishedAt: source.publishedAt,
    status: initialStatus(source.tier),
    extraction: null,
    embedding: null,
    createdAt: now,
  });
  try {
    await events.insertOne(event);
    return { sourceId: source._id, eventId: event._id, sourceCreated, eventCreated: true };
  } catch (error) {
    // A concurrent replay of the same item inserted it first; the unique index kept one.
    if (!(error instanceof MongoServerError && error.code === DUPLICATE_KEY)) throw error;
    const winner = await events.findOne({ sourceIds: source._id });
    if (!winner) throw error;
    return { sourceId: source._id, eventId: winner._id, sourceCreated, eventCreated: false };
  }
}
