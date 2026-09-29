import { DEMO_PERSONAS, DEMO_SOURCE_ID, EventExplain, FeedCard } from '@kesher/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { COLLECTION_NAMES, collection } from '../db/collections';
import { toIncomingItem } from '../ingest/alpaca';
import { processItem } from '../ingest/process';
import { loadRecording } from '../ingest/recordings';
import { loadModelRecording } from '../llm/recordings';
import { runSeed } from '../seed/seed';
import { recordedModels, signIn, startApi, type TestApi } from '../test/api';
import { MONGO_START_TIMEOUT_MS, startTestMongo, type TestMongo } from '../test/mongo';

const now = new Date('2026-09-28T12:00:00Z');

// JSON carries dates as ISO strings; the web converts them the same way before parsing.
const revive = (text: string) =>
  JSON.parse(text, (_key, value: unknown) =>
    typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(value)
      ? new Date(value)
      : value,
  ) as unknown;

describe('GET /feed and GET /events/:eventId/explain, on mongod', () => {
  let mongo: TestMongo;
  let api: TestApi;
  let eventId: string;
  const cookies = { A: '', B: '', C: '' };
  const userId = async (index: number) =>
    (await collection(mongo.db, 'users').findOne({ email: DEMO_PERSONAS[index]!.email }))!._id;

  const get = (path: string, cookie?: string) =>
    fetch(`${api.url}${path}`, cookie ? { headers: { cookie } } : undefined);
  const feed = async (cookie: string, query = '') =>
    z.array(FeedCard).parse(revive(await (await get(`/feed${query}`, cookie)).text()));
  const explain = async (cookie: string, id = eventId) =>
    EventExplain.parse(revive(await (await get(`/events/${id}/explain`, cookie)).text()));

  beforeAll(async () => {
    mongo = await startTestMongo('kesher_feed_test');
    await runSeed(mongo.db, now);
    const models = recordedModels((await loadModelRecording(DEMO_SOURCE_ID))!);
    const result = await processItem(
      mongo.db,
      toIncomingItem((await loadRecording(DEMO_SOURCE_ID))!.item),
      { mode: 'replay', models, now: () => now, log: () => {} },
    );
    if (result.outcome !== 'processed') throw new Error('expected processed');
    eventId = result.eventId;
    api = await startApi(mongo.db);
    for (const key of ['A', 'B', 'C'] as const) cookies[key] = await signIn(api.url, key);
  }, MONGO_START_TIMEOUT_MS);

  afterAll(async () => {
    await api?.close();
    await mongo?.stop();
  });

  describe('GET /feed', () => {
    it('answers 401 without a session', async () => {
      expect((await get('/feed')).status).toBe(401);
    });

    it('gives A the supplier card and B the direct card, each for that user only', async () => {
      const [a] = await feed(cookies.A);
      const [b] = await feed(cookies.B);

      expect(a?.item).toMatchObject({ userId: await userId(0), relevance: 0.8 });
      expect(a?.evidence[0]).toMatchObject({ from: 'TSM', to: 'NVDA', type: 'supplier_of' });
      expect(b?.item).toMatchObject({ userId: await userId(1), relevance: 1 });
    });

    it('hides relevance 0: C gets an empty feed although C has a stored item', async () => {
      expect(await feed(cookies.C)).toEqual([]);
      expect(
        await collection(mongo.db, 'feed_items').countDocuments({ userId: await userId(2) }),
      ).toBe(1);
    });

    it('ignores a user named in the query', async () => {
      const a = await userId(0);
      const cards = await feed(cookies.C, `?userId=${a}`);
      expect(cards).toEqual([]);
    });

    it('lists newest first', async () => {
      const [card] = await feed(cookies.B);
      const ids = {
        source: '44444444-4444-4444-8444-444444444444',
        event: '55555555-5555-4555-8555-555555555555',
        item: '66666666-6666-4666-8666-666666666666',
      };
      // A second event with its own source, scored for B a minute later.
      const source = (await collection(mongo.db, 'sources').findOne({
        externalId: DEMO_SOURCE_ID,
      }))!;
      const event = (await collection(mongo.db, 'market_events').findOne({ _id: eventId }))!;
      await collection(mongo.db, 'sources').insertOne({
        ...source,
        _id: ids.source,
        externalId: '1',
      });
      await collection(mongo.db, 'market_events').insertOne({
        ...event,
        _id: ids.event,
        sourceIds: [ids.source],
      });
      await collection(mongo.db, 'feed_items').insertOne({
        ...card!.item,
        _id: ids.item,
        eventId: ids.event,
        createdAt: new Date(now.getTime() + 60_000),
      });
      try {
        expect((await feed(cookies.B)).map((c) => c.item._id)).toEqual([ids.item, card!.item._id]);
      } finally {
        await collection(mongo.db, 'feed_items').deleteOne({ _id: ids.item });
        await collection(mongo.db, 'market_events').deleteOne({ _id: ids.event });
        await collection(mongo.db, 'sources').deleteOne({ _id: ids.source });
      }
    });
  });

  describe('GET /events/:eventId/explain', () => {
    it('explains None for C: relevance 0 and no path', async () => {
      const response = await explain(cookies.C);
      expect(response).toMatchObject({ relevance: 0, path: null, evidence: [] });
      expect(response.event._id).toBe(eventId);
      expect(response.source).toMatchObject({ externalId: DEMO_SOURCE_ID, publisher: 'Benzinga' });
    });

    it('explains the same path the feed shows, for A and B', async () => {
      const a = await explain(cookies.A);
      const [card] = await feed(cookies.A);
      expect(a).toMatchObject({ relevance: 0.8, path: card!.item.path, evidence: card!.evidence });
      expect((await explain(cookies.B)).path).toEqual({
        eventCompany: 'TSM',
        holding: 'TSM',
        hops: [],
      });
    });

    it('writes nothing', async () => {
      const count = async () =>
        Object.fromEntries(
          await Promise.all(
            COLLECTION_NAMES.map(
              async (name) => [name, await collection(mongo.db, name).countDocuments()] as const,
            ),
          ),
        );
      const items = await collection(mongo.db, 'feed_items').find({}).toArray();
      const before = await count();

      for (const key of ['A', 'B', 'C'] as const) await explain(cookies[key]);

      expect(await count()).toEqual(before);
      expect(await collection(mongo.db, 'feed_items').find({}).toArray()).toEqual(items);
    });

    it('answers 401 without a session, 400 for a bad id and 404 for an unknown event', async () => {
      expect((await get(`/events/${eventId}/explain`)).status).toBe(401);
      expect((await get('/events/not-an-id/explain', cookies.C)).status).toBe(400);
      expect(
        (await get('/events/77777777-7777-4777-8777-777777777777/explain', cookies.C)).status,
      ).toBe(404);
    });
  });
});
