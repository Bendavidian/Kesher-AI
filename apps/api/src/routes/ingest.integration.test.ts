import { randomUUID } from 'node:crypto';
import { DEMO_SOURCE_ID, IngestStatus, type LiveStatus } from '@kesher/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { collection } from '../db/collections';
import { countDrop } from '../ingest/counters';
import { recordLive, loadRecording } from '../ingest/recordings';
import { reserveLiveExtraction } from '../ingest/extractionBudget';
import { runSeed } from '../seed/seed';
import { signIn, startApi, type TestApi } from '../test/api';
import { MONGO_START_TIMEOUT_MS, startTestMongo, type TestMongo } from '../test/mongo';

const revive = (value: unknown) =>
  JSON.parse(JSON.stringify(value), (_key, v: unknown) =>
    typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(v) ? new Date(v) : v,
  ) as unknown;

describe('GET /ingest/status on mongod', () => {
  let mongo: TestMongo;
  let api: TestApi | undefined;
  let live: LiveStatus | null;

  beforeAll(async () => {
    mongo = await startTestMongo('kesher_ingest_status_test');
    await runSeed(mongo.db, new Date());
  }, MONGO_START_TIMEOUT_MS);

  afterEach(async () => {
    await api?.close();
    api = undefined;
    for (const name of ['ingest_counters', 'ingest_budget', 'recordings'] as const) {
      await collection(mongo.db, name).deleteMany({});
    }
  });

  afterAll(async () => {
    await mongo?.stop();
  });

  const status = async (cookie?: string) =>
    fetch(`${api!.url}/ingest/status`, cookie ? { headers: { cookie } } : {});

  it('answers 401 without a session', async () => {
    api = await startApi(mongo.db);
    expect((await status()).status).toBe(401);
  });

  it('where live ingestion is off: live null, and the day from the database', async () => {
    api = await startApi(mongo.db);
    const now = new Date();
    const demo = (await loadRecording(DEMO_SOURCE_ID))!.item;
    await recordLive(mongo.db, { provider: 'alpaca', item: { ...demo, id: 99000101 } }, now);
    await countDrop(mongo.db, 'not_in_universe', 'live', now);
    await countDrop(mongo.db, 'not_in_universe', 'live', now);
    await countDrop(mongo.db, 'daily_cap', 'live', now);
    // Replay counters and yesterday's stay out.
    await countDrop(mongo.db, 'duplicate', 'replay', now);
    await countDrop(mongo.db, 'queue_full', 'live', new Date(now.getTime() - 86_400_000));
    await reserveLiveExtraction(mongo.db, now);

    const response = await status(await signIn(api.url, 'C'));

    expect(response.status).toBe(200);
    expect(IngestStatus.parse(revive(await response.json()))).toEqual({
      live: null,
      lastItemAt: now,
      today: {
        day: now.toISOString().slice(0, 10),
        extractions: { used: 1, limit: 150 },
        counters: [
          { reason: 'daily_cap', count: 1 },
          { reason: 'not_in_universe', count: 2 },
        ],
      },
    });
  });

  it('where live ingestion runs: its stream, poller and queue', async () => {
    const at = new Date('2026-10-01T14:00:00Z');
    live = {
      stream: { state: 'subscribed', since: at, lastMessageAt: at },
      edgar: { lastPollAt: at, pausedUntil: null },
      queue: { waiting: 3, running: true, limit: 50 },
    };
    api = await startApi(mongo.db, { liveStatus: () => live });

    const body = IngestStatus.parse(
      revive(await (await status(await signIn(api.url, 'A'))).json()),
    );

    expect(body.live).toEqual(live);
    expect(body).toMatchObject({ lastItemAt: null, today: { counters: [] } });
    expect(body.today.extractions).toEqual({ used: 0, limit: 150 });
  });

  it('never takes a user id: the answer has none and a query cannot add one', async () => {
    api = await startApi(mongo.db);
    const cookie = await signIn(api.url, 'B');
    const response = await fetch(`${api.url}/ingest/status?userId=${randomUUID()}`, {
      headers: { cookie },
    });
    expect(response.status).toBe(200);
    expect(JSON.stringify(await response.json())).not.toMatch(/userId/);
  });
});
