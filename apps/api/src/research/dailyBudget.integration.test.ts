import { ResearchBudgetDay } from '@kesher/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { collection } from '../db/collections';
import { ensureCollections, ensureIndexes } from '../db/indexes';
import { MONGO_START_TIMEOUT_MS, startTestMongo, type TestMongo } from '../test/mongo';
import { AUTO_RUN_LIMIT, DAILY_RUN_LIMIT, reserveRun } from './dailyBudget';

const now = new Date('2026-09-29T12:00:00Z');

describe('reserveRun, the daily research budget, on mongod', () => {
  let mongo: TestMongo;

  beforeAll(async () => {
    mongo = await startTestMongo('kesher_daily_budget_test');
    await ensureCollections(mongo.db);
    await ensureIndexes(mongo.db);
  }, MONGO_START_TIMEOUT_MS);

  beforeEach(async () => {
    await collection(mongo.db, 'research_budget').deleteMany({});
  });

  afterAll(async () => {
    await mongo?.stop();
  });

  it('keeps 10 of 30 runs a day for Investigate', () => {
    expect(DAILY_RUN_LIMIT).toBe(30);
    expect(AUTO_RUN_LIMIT).toBe(20);
  });

  it('reserves Investigate runs up to 30 a day, then refuses', async () => {
    for (let run = 1; run <= DAILY_RUN_LIMIT; run += 1) {
      expect(await reserveRun(mongo.db, 'investigate', now)).toEqual({
        reserved: true,
        runs: run,
        limit: DAILY_RUN_LIMIT,
      });
    }
    expect(await reserveRun(mongo.db, 'investigate', now)).toEqual({
      reserved: false,
      runs: DAILY_RUN_LIMIT,
      limit: DAILY_RUN_LIMIT,
    });
    const [day] = await collection(mongo.db, 'research_budget').find().toArray();
    expect(ResearchBudgetDay.parse(day)).toMatchObject({ day: '2026-09-29', runs: 30 });
  });

  it('stops automatic runs at 20 while Investigate goes on to 30', async () => {
    for (let run = 1; run <= AUTO_RUN_LIMIT; run += 1) {
      expect(await reserveRun(mongo.db, 'gate', now)).toMatchObject({ reserved: true, runs: run });
    }
    expect(await reserveRun(mongo.db, 'gate', now)).toEqual({
      reserved: false,
      runs: AUTO_RUN_LIMIT,
      limit: AUTO_RUN_LIMIT,
    });
    expect(await reserveRun(mongo.db, 'investigate', now)).toMatchObject({
      reserved: true,
      runs: AUTO_RUN_LIMIT + 1,
    });
    // Investigate runs count against the automatic limit too.
    expect(await reserveRun(mongo.db, 'gate', now)).toMatchObject({
      reserved: false,
      runs: AUTO_RUN_LIMIT + 1,
    });
  });

  it('starts every UTC day at 0', async () => {
    for (let run = 1; run <= DAILY_RUN_LIMIT; run += 1) {
      await reserveRun(mongo.db, 'investigate', new Date('2026-09-29T23:59:59Z'));
    }
    expect(
      await reserveRun(mongo.db, 'investigate', new Date('2026-09-30T00:00:00Z')),
    ).toMatchObject({ reserved: true, runs: 1 });
  });

  it('never reserves more than the limit under concurrent requests', async () => {
    const results = await Promise.all(
      Array.from({ length: 40 }, () => reserveRun(mongo.db, 'investigate', now)),
    );
    expect(results.filter((r) => r.reserved)).toHaveLength(DAILY_RUN_LIMIT);
    expect(
      results
        .filter((r) => r.reserved)
        .map((r) => r.runs)
        .sort((a, b) => a - b),
    ).toEqual(Array.from({ length: DAILY_RUN_LIMIT }, (_, i) => i + 1));
    expect(await collection(mongo.db, 'research_budget').countDocuments()).toBe(1);
  });
});
