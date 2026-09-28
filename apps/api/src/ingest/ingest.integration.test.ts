import { MarketEvent, Source } from '@kesher/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { collection } from '../db/collections';
import { ensureCollections, ensureIndexes } from '../db/indexes';
import { DEMO_SOURCE_ID } from '../seed/config';
import { MONGO_START_TIMEOUT_MS, startTestMongo, type TestMongo } from '../test/mongo';
import { toIncomingItem } from './alpaca';
import { ingestItem, initialStatus } from './ingest';
import { loadRecording } from './recordings';

describe('ingestItem on mongod', () => {
  let mongo: TestMongo;
  let item: ReturnType<typeof toIncomingItem>;

  const counts = async () => ({
    sources: await collection(mongo.db, 'sources').countDocuments(),
    events: await collection(mongo.db, 'market_events').countDocuments(),
  });

  beforeAll(async () => {
    mongo = await startTestMongo('kesher_ingest_test');
    await ensureCollections(mongo.db);
    await ensureIndexes(mongo.db);
    const recording = await loadRecording(DEMO_SOURCE_ID);
    item = toIncomingItem(recording!.item);
  }, MONGO_START_TIMEOUT_MS);

  beforeEach(async () => {
    await collection(mongo.db, 'sources').deleteMany({});
    await collection(mongo.db, 'market_events').deleteMany({});
  });

  afterAll(async () => {
    await mongo?.stop();
  });

  it('stores the demo Source and creates one MarketEvent for it', async () => {
    const result = await ingestItem(mongo.db, item);

    expect(result).toMatchObject({ sourceCreated: true, eventCreated: true });
    expect(await counts()).toEqual({ sources: 1, events: 1 });

    const source = Source.parse(await collection(mongo.db, 'sources').findOne({}));
    expect(source).toMatchObject({
      _id: result.sourceId,
      provider: 'alpaca',
      externalId: DEMO_SOURCE_ID,
      tier: 2,
      injectionScreen: null,
    });
    expect(source.text).toMatch(/^Taiwan was struck by a powerful 7\.2 magnitude earthquake/);

    const event = MarketEvent.parse(await collection(mongo.db, 'market_events').findOne({}));
    expect(event).toMatchObject({
      _id: result.eventId,
      sourceIds: [result.sourceId],
      headline: source.title,
      publishedAt: new Date('2024-04-03T03:57:09Z'),
      status: 'confirmed',
      extraction: null,
      embedding: null,
    });
  });

  it('creates nothing on a second ingest of the same item', async () => {
    const first = await ingestItem(mongo.db, item);
    const second = await ingestItem(mongo.db, item, new Date(Date.now() + 60_000));

    expect(second).toEqual({
      sourceId: first.sourceId,
      eventId: first.eventId,
      sourceCreated: false,
      eventCreated: false,
    });
    expect(await counts()).toEqual({ sources: 1, events: 1 });
  });

  it('keeps one event when the same item is ingested concurrently', async () => {
    const results = await Promise.all([1, 2, 3].map(() => ingestItem(mongo.db, item)));

    expect(new Set(results.map((r) => r.eventId)).size).toBe(1);
    expect(results.filter((r) => r.eventCreated)).toHaveLength(1);
    expect(await counts()).toEqual({ sources: 1, events: 1 });
  });

  it('never erases the screen, the extraction or createdAt on replay', async () => {
    const first = await ingestItem(mongo.db, item);
    const screenedAt = new Date('2026-09-28T10:00:00Z');
    const screen = { flagged: true, score: 0.97, model: 'prompt-guard', screenedAt };
    const extraction = {
      companies: [{ symbol: 'TSM', impact: 'negative' as const }],
      eventType: 'natural_disaster' as const,
      themes: ['foundry' as const],
      importance: 4,
      provider: 'groq' as const,
      model: 'openai/gpt-oss-120b',
      extractedAt: screenedAt,
    };
    await collection(mongo.db, 'sources').updateOne(
      { _id: first.sourceId },
      { $set: { injectionScreen: screen } },
    );
    await collection(mongo.db, 'market_events').updateOne(
      { _id: first.eventId },
      { $set: { extraction } },
    );
    const before = await collection(mongo.db, 'sources').findOne({ _id: first.sourceId });

    await ingestItem(mongo.db, item, new Date(Date.now() + 60_000));

    const source = await collection(mongo.db, 'sources').findOne({ _id: first.sourceId });
    const event = await collection(mongo.db, 'market_events').findOne({ _id: first.eventId });
    expect(source?.injectionScreen).toEqual(screen);
    expect(source?.createdAt).toEqual(before?.createdAt);
    expect(event?.extraction).toEqual(extraction);
  });

  it('rejects an item that fails the Source schema before any write', async () => {
    await expect(ingestItem(mongo.db, { ...item, title: ' ' })).rejects.toThrow();
    await expect(ingestItem(mongo.db, { ...item, url: 'not a url' })).rejects.toThrow();
    expect(await counts()).toEqual({ sources: 0, events: 0 });
  });
});

describe('initialStatus', () => {
  it('confirms primary sources and wires, not social posts', () => {
    expect(initialStatus(1)).toBe('confirmed');
    expect(initialStatus(2)).toBe('confirmed');
    expect(initialStatus(3)).toBe('unconfirmed');
  });
});
