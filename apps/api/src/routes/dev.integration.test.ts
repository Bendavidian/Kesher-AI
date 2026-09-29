import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ReplayResponse, ResetResponse } from '@kesher/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { collection } from '../db/collections';
import { ensureCollections, ensureIndexes } from '../db/indexes';
import { createModelClient, MODELS } from '../llm/client';
import { loadModelRecording, type ModelRecording } from '../llm/recordings';
import { DEMO_SOURCE_ID } from '../seed/config';
import { mockModel, rateLimitError, resolveMocks } from '../test/models';
import { MONGO_START_TIMEOUT_MS, startTestMongo, type TestMongo } from '../test/mongo';

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

async function close(server: Server | undefined): Promise<void> {
  if (!server) return;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

describe('POST /dev/replay/:sourceId', () => {
  let mongo: TestMongo;
  let recorded: ModelRecording;
  let server: Server;
  let keylessServer: Server;
  let limitedServer: Server;
  let prodServer: Server;
  let baseUrl: string;
  let keylessUrl: string;
  let limitedUrl: string;
  let prodUrl: string;

  const replay = (id: string, url = baseUrl) =>
    fetch(`${url}/dev/replay/${id}`, { method: 'POST' });
  const counts = async () => ({
    sources: await collection(mongo.db, 'sources').countDocuments({ externalId: DEMO_SOURCE_ID }),
    events: await collection(mongo.db, 'market_events').countDocuments(),
  });
  // The recorded answers for the demo item, replayed; no test calls a provider.
  const recordedModels = () => {
    const guard = mockModel(MODELS.screen.model, recorded.screen.chunks);
    const groq = mockModel(MODELS.extraction.model, [recorded.extraction.text]);
    return createModelClient({
      resolve: resolveMocks({ [guard.modelId]: guard, [groq.modelId]: groq }),
    });
  };
  const rateLimited = () => {
    const guard = mockModel(MODELS.screen.model, [rateLimitError()]);
    const groq = mockModel(MODELS.extraction.model, [rateLimitError()]);
    const gemini = mockModel(MODELS.fallback.model, [rateLimitError()]);
    return createModelClient({
      resolve: resolveMocks({
        [guard.modelId]: guard,
        [groq.modelId]: groq,
        [gemini.modelId]: gemini,
      }),
    });
  };

  beforeAll(async () => {
    mongo = await startTestMongo('kesher_replay_test');
    await ensureCollections(mongo.db);
    await ensureIndexes(mongo.db);
    recorded = (await loadModelRecording(DEMO_SOURCE_ID))!;
    const quiet = () => undefined;
    server = createApp({ db: mongo.db, devRoutes: true, models: recordedModels }).listen(0);
    baseUrl = await listen(server);
    keylessServer = createApp({ db: mongo.db, devRoutes: true, logError: quiet }).listen(0);
    keylessUrl = await listen(keylessServer);
    limitedServer = createApp({
      db: mongo.db,
      devRoutes: true,
      models: rateLimited,
      logError: quiet,
      log: quiet,
    }).listen(0);
    limitedUrl = await listen(limitedServer);
    prodServer = createApp({ db: mongo.db, devRoutes: false }).listen(0);
    prodUrl = await listen(prodServer);
  }, MONGO_START_TIMEOUT_MS);

  beforeEach(async () => {
    for (const name of ['sources', 'market_events', 'ingest_counters'] as const) {
      await collection(mongo.db, name).deleteMany({});
    }
  });

  afterAll(async () => {
    for (const s of [server, keylessServer, limitedServer, prodServer]) await close(s);
    await mongo?.stop();
  });

  it('replaying DEMO_SOURCE_ID creates exactly one Source and one extracted MarketEvent', async () => {
    const response = await replay(DEMO_SOURCE_ID);

    expect(response.status).toBe(200);
    const body = ReplayResponse.parse(await response.json());
    if (body.outcome !== 'processed') throw new Error(`dropped: ${body.reason}`);
    expect(body).toMatchObject({ sourceCreated: true, eventCreated: true });
    expect(await counts()).toEqual({ sources: 1, events: 1 });

    const event = await collection(mongo.db, 'market_events').findOne({ _id: body.eventId });
    expect(event?.sourceIds).toEqual([body.sourceId]);
    expect(event?.extraction?.companies.map((c) => c.symbol)).toContain('TSM');
  });

  it('a second replay is a duplicate with the same ids, and needs no model key', async () => {
    const first = ReplayResponse.parse(await (await replay(DEMO_SOURCE_ID)).json());
    if (first.outcome !== 'processed') throw new Error('expected processed');

    const second = await replay(DEMO_SOURCE_ID, keylessUrl);

    expect(second.status).toBe(200);
    expect(ReplayResponse.parse(await second.json())).toEqual({
      outcome: 'dropped',
      reason: 'duplicate',
      sourceId: first.sourceId,
      eventId: first.eventId,
    });
    expect(await counts()).toEqual({ sources: 1, events: 1 });
  });

  it('answers 503 naming the missing key, and keeps the item for the next replay', async () => {
    const response = await replay(DEMO_SOURCE_ID, keylessUrl);

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: 'GROQ_API_KEY is not set; the screen and extraction need it',
    });
    const event = await collection(mongo.db, 'market_events').findOne({});
    expect(event?.extraction).toBeNull();

    const retry = ReplayResponse.parse(await (await replay(DEMO_SOURCE_ID)).json());
    expect(retry).toMatchObject({ outcome: 'processed', sourceCreated: false });
  });

  it('answers 503 when both model providers are rate limited', async () => {
    const response = await replay(DEMO_SOURCE_ID, limitedUrl);

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: 'the model providers are rate limited; replay again later',
    });
  });

  it('answers 400 for an id that is not an Alpaca news id', async () => {
    for (const id of ['abc', '38062166.json', '%2E%2E%2Fx']) {
      expect((await replay(id)).status, id).toBe(400);
    }
  });

  it('answers 404 for an id with no recording', async () => {
    const response = await replay('999');
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'no recording for Alpaca news 999' });
  });

  it('is not mounted when dev routes are off', async () => {
    expect((await replay(DEMO_SOURCE_ID, prodUrl)).status).toBe(404);
  });

  describe('POST /dev/reset/:sourceId', () => {
    const reset = (id: string, url = baseUrl) =>
      fetch(`${url}/dev/reset/${id}`, { method: 'POST' });

    it('deletes only the FeedItems of the replayed event', async () => {
      const replayed = ReplayResponse.parse(await (await replay(DEMO_SOURCE_ID)).json());
      if (replayed.outcome !== 'processed') throw new Error('expected processed');
      const items = collection(mongo.db, 'feed_items');
      const other = {
        _id: '88888888-8888-4888-8888-888888888888',
        userId: '99999999-9999-4999-8999-999999999999',
        eventId: '77777777-7777-4777-8777-777777777777',
        relevance: 0,
        path: null,
        confidence: 'low' as const,
        status: 'unconfirmed' as const,
        research: { state: 'none' as const, runId: null },
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      await items.insertMany([
        { ...other, _id: '88888888-8888-4888-8888-888888888889', eventId: replayed.eventId },
        other,
      ]);
      try {
        const response = await reset(DEMO_SOURCE_ID);
        expect(response.status).toBe(200);
        expect(ResetResponse.parse(await response.json())).toEqual({
          sourceId: replayed.sourceId,
          eventId: replayed.eventId,
          deleted: 1,
        });
        expect(await items.countDocuments({ eventId: replayed.eventId })).toBe(0);
        expect(await items.countDocuments({ _id: other._id })).toBe(1);
        const event = await collection(mongo.db, 'market_events').findOne({
          _id: replayed.eventId,
        });
        expect(event?.extraction).not.toBeNull();
      } finally {
        await items.deleteMany({});
      }
    });

    it('answers 400 for a bad id and 404 for an item never replayed', async () => {
      expect((await reset('abc')).status).toBe(400);
      const response = await reset('999');
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: 'Alpaca news 999 has not been replayed' });
    });

    it('is not mounted when dev routes are off', async () => {
      expect((await reset(DEMO_SOURCE_ID, prodUrl)).status).toBe(404);
    });
  });
});
