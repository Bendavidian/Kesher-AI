import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MONGO_START_TIMEOUT_MS, startTestMongo, type TestMongo } from '../test/mongo';
import {
  backfillPublishers,
  backfillReportCore,
  backfillResearchReports,
  backfillVerification,
} from './backfill';

const at = new Date('2026-09-28T12:00:00Z');

// A Source as T04 stored it, before publisher existed.
const legacy = (id: string, provider: string, externalId: string) => ({
  _id: id,
  provider,
  kind: provider === 'alpaca' ? 'news' : 'filing',
  tier: provider === 'alpaca' ? 2 : 1,
  externalId,
  url: 'https://example.com/item',
  author: null,
  title: 'A stored item',
  text: null,
  symbols: ['TSM'],
  publishedAt: at,
  injectionScreen: null,
  createdAt: at,
});

describe('backfillPublishers on mongod', () => {
  let mongo: TestMongo;

  beforeAll(async () => {
    mongo = await startTestMongo('kesher_backfill_test');
    await mongo.db
      .collection<{ _id: string; publisher?: string }>('sources')
      .insertMany([
        legacy('a', 'alpaca', '38062166'),
        legacy('b', 'alpaca', '999999999999'),
        legacy('c', 'sec_edgar', '0001045810-26-000021'),
        { ...legacy('d', 'alpaca', '1'), publisher: 'Reuters' },
      ]);
  }, MONGO_START_TIMEOUT_MS);

  afterAll(async () => {
    await mongo?.stop();
  });

  it('fills a missing publisher from the recording, else null, and keeps a stored one', async () => {
    expect(await backfillPublishers(mongo.db)).toBe(3);
    const publishers = await mongo.db
      .collection<{ _id: string; publisher: string | null }>('sources')
      .find({}, { projection: { publisher: 1 }, sort: { _id: 1 } })
      .toArray();
    expect(publishers).toEqual([
      { _id: 'a', publisher: 'Benzinga' },
      { _id: 'b', publisher: null },
      { _id: 'c', publisher: null },
      { _id: 'd', publisher: 'Reuters' },
    ]);
  });

  it('changes nothing on a second run', async () => {
    expect(await backfillPublishers(mongo.db)).toBe(0);
  });
});

describe('backfillResearchReports on mongod', () => {
  let mongo: TestMongo;

  beforeAll(async () => {
    mongo = await startTestMongo('kesher_backfill_research_test');
    await mongo.db.collection<{ _id: string; research: object }>('feed_items').insertMany([
      // As T05 stored it, before reportId existed.
      { _id: 'a', research: { state: 'none', runId: null } },
      { _id: 'b', research: { state: 'done', runId: 'r', reportId: 'p' } },
    ]);
  }, MONGO_START_TIMEOUT_MS);

  afterAll(async () => {
    await mongo?.stop();
  });

  it('sets a missing reportId to null and keeps a stored one', async () => {
    expect(await backfillResearchReports(mongo.db)).toBe(1);
    const items = await mongo.db
      .collection<{ _id: string; research: object }>('feed_items')
      .find({}, { sort: { _id: 1 } })
      .toArray();
    expect(items).toEqual([
      { _id: 'a', research: { state: 'none', runId: null, reportId: null } },
      { _id: 'b', research: { state: 'done', runId: 'r', reportId: 'p' } },
    ]);
  });

  it('changes nothing on a second run', async () => {
    expect(await backfillResearchReports(mongo.db)).toBe(0);
  });
});

describe('backfillVerification on mongod', () => {
  let mongo: TestMongo;

  beforeAll(async () => {
    mongo = await startTestMongo('kesher_backfill_verification_test');
    await mongo.db.collection<{ _id: string; verification?: object }>('agent_runs').insertMany([
      // As T08 stored it, before verification existed.
      { _id: 'old' },
      { _id: 'new', verification: { tokenCap: 6000, tokensUsed: 900 } },
    ]);
    await mongo.db
      .collection<{ _id: string; type: string; figures?: object[] }>('claims')
      .insertMany([
        { _id: 'm', type: 'metric' },
        { _id: 'f', type: 'fact' },
        { _id: 'k', type: 'metric', figures: [{ symbol: 'TSM', window: 'open_gap', pct: -1.16 }] },
      ]);
  }, MONGO_START_TIMEOUT_MS);

  afterAll(async () => {
    await mongo?.stop();
  });

  it('sets a missing verification to null and missing metric figures to none', async () => {
    expect(await backfillVerification(mongo.db)).toEqual({ runs: 1, claims: 1 });
    const runs = await mongo.db.collection<{ _id: string }>('agent_runs').find().toArray();
    expect(runs).toContainEqual({ _id: 'old', verification: null });
    expect(runs).toContainEqual({ _id: 'new', verification: { tokenCap: 6000, tokensUsed: 900 } });
    const claims = await mongo.db.collection<{ _id: string }>('claims').find().toArray();
    expect(claims).toContainEqual({ _id: 'm', type: 'metric', figures: [] });
    expect(claims).toContainEqual({ _id: 'f', type: 'fact' });
  });

  it('changes nothing on a second run', async () => {
    expect(await backfillVerification(mongo.db)).toEqual({ runs: 0, claims: 0 });
  });
});

describe('backfillReportCore on mongod', () => {
  let mongo: TestMongo;

  beforeAll(async () => {
    mongo = await startTestMongo('kesher_backfill_report_core_test');
    await mongo.db.collection<{ _id: string; origin?: string }>('claims').insertMany([
      // As T14 stored it, before origin existed.
      { _id: 'old' },
      { _id: 'code', origin: 'code' },
    ]);
    await mongo.db
      .collection<{ _id: string; omitted?: object[] }>('reports')
      .insertMany([
        { _id: 'old' },
        { _id: 'new', omitted: [{ kind: 'price_metric', reason: 'not_ready' }] },
      ]);
  }, MONGO_START_TIMEOUT_MS);

  afterAll(async () => {
    await mongo?.stop();
  });

  it("marks older claims as the model's and gives older reports nothing omitted", async () => {
    expect(await backfillReportCore(mongo.db)).toEqual({ claims: 1, reports: 1 });
    const claims = await mongo.db.collection<{ _id: string }>('claims').find().toArray();
    expect(claims).toContainEqual({ _id: 'old', origin: 'model' });
    expect(claims).toContainEqual({ _id: 'code', origin: 'code' });
    const reports = await mongo.db.collection<{ _id: string }>('reports').find().toArray();
    expect(reports).toContainEqual({ _id: 'old', omitted: [] });
    expect(reports).toContainEqual({
      _id: 'new',
      omitted: [{ kind: 'price_metric', reason: 'not_ready' }],
    });
  });

  it('changes nothing on a second run', async () => {
    expect(await backfillReportCore(mongo.db)).toEqual({ claims: 0, reports: 0 });
  });
});
