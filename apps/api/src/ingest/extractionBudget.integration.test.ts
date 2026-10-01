import { IngestBudgetDay } from '@kesher/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { collection } from '../db/collections';
import { ensureCollections, ensureIndexes } from '../db/indexes';
import { MONGO_START_TIMEOUT_MS, startTestMongo, type TestMongo } from '../test/mongo';
import {
  LIVE_EXTRACTION_DAILY_LIMIT,
  liveExtractionsOn,
  reserveLiveExtraction,
} from './extractionBudget';

const now = new Date('2026-10-01T12:00:00Z');

describe('reserveLiveExtraction, the daily live extraction cap, on mongod', () => {
  let mongo: TestMongo;

  beforeAll(async () => {
    mongo = await startTestMongo('kesher_extraction_budget_test');
    await ensureCollections(mongo.db);
    await ensureIndexes(mongo.db);
  }, MONGO_START_TIMEOUT_MS);

  beforeEach(async () => {
    await collection(mongo.db, 'ingest_budget').deleteMany({});
  });

  afterAll(async () => {
    await mongo?.stop();
  });

  it('allows 150 live news extractions a day', () => {
    expect(LIVE_EXTRACTION_DAILY_LIMIT).toBe(150);
  });

  it('reserves up to the limit, then refuses, in one document per day', async () => {
    for (let n = 1; n <= 3; n += 1) {
      expect(await reserveLiveExtraction(mongo.db, now, 3)).toEqual({
        reserved: true,
        extractions: n,
        limit: 3,
      });
    }
    expect(await reserveLiveExtraction(mongo.db, now, 3)).toEqual({
      reserved: false,
      extractions: 3,
      limit: 3,
    });
    const days = await collection(mongo.db, 'ingest_budget').find().toArray();
    expect(days.map((d) => IngestBudgetDay.parse(d))).toMatchObject([
      { day: '2026-10-01', extractions: 3 },
    ]);
    expect(await liveExtractionsOn(mongo.db, '2026-10-01')).toBe(3);
  });

  it('starts every UTC day at 0', async () => {
    for (let n = 1; n <= 2; n += 1) {
      await reserveLiveExtraction(mongo.db, new Date('2026-10-01T23:59:59Z'), 2);
    }
    expect(
      await reserveLiveExtraction(mongo.db, new Date('2026-10-02T00:00:00Z'), 2),
    ).toMatchObject({ reserved: true, extractions: 1 });
    expect(await liveExtractionsOn(mongo.db, '2026-10-03')).toBe(0);
  });

  it('never reserves more than the limit under concurrent requests', async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, () => reserveLiveExtraction(mongo.db, now, 12)),
    );
    expect(results.filter((r) => r.reserved)).toHaveLength(12);
    expect(await collection(mongo.db, 'ingest_budget').countDocuments()).toBe(1);
  });
});
