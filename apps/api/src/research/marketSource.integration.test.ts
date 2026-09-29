import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { collection } from '../db/collections';
import { ensureCollections, ensureIndexes } from '../db/indexes';
import { MONGO_START_TIMEOUT_MS, startTestMongo, type TestMongo } from '../test/mongo';
import { upsertMarketSource } from './marketSource';

describe('upsertMarketSource on mongod', () => {
  let mongo: TestMongo;
  const eventId = randomUUID();

  beforeAll(async () => {
    mongo = await startTestMongo('kesher_market_source_test');
    await ensureCollections(mongo.db);
    await ensureIndexes(mongo.db);
  }, MONGO_START_TIMEOUT_MS);

  afterAll(async () => {
    await mongo?.stop();
  });

  it('keeps one source per event and set of symbols, subjects first, then SMH and SPY', async () => {
    const first = await upsertMarketSource(mongo.db, eventId, ['SPY', 'NVDA', 'TSM']);
    const again = await upsertMarketSource(mongo.db, eventId, ['NVDA', 'TSM', 'SMH']);
    const other = await upsertMarketSource(mongo.db, eventId, ['NVDA', 'AMZN']);

    expect(again).toBe(first);
    expect(other).not.toBe(first);
    const stored = await collection(mongo.db, 'sources').findOne({ _id: first });
    expect(stored).toMatchObject({
      kind: 'market_data',
      symbols: ['NVDA', 'TSM', 'SMH', 'SPY'],
      text: null,
      injectionScreen: null,
    });
    expect((await collection(mongo.db, 'sources').findOne({ _id: other }))?.symbols).toEqual([
      'NVDA',
      'AMZN',
      'SMH',
      'SPY',
    ]);
  });
});
