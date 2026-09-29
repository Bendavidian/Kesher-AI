import { nameUuid, sourceIdName } from '@kesher/mcp';
import { priceReactionExternalId } from '@kesher/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { collection } from '../db/collections';
import { ensureCollections, ensureIndexes } from '../db/indexes';
import { loadReactionFixture } from '../market/fixture';
import { DEMO_SOURCE_ID } from '../seed/config';
import { MONGO_START_TIMEOUT_MS, startTestMongo, type TestMongo } from '../test/mongo';
import { upsertPriceReactionSource } from './marketData';

describe('upsertPriceReactionSource on mongod', () => {
  let mongo: TestMongo;

  beforeAll(async () => {
    mongo = await startTestMongo('kesher_market_source_test');
    await ensureCollections(mongo.db);
    await ensureIndexes(mongo.db);
  }, MONGO_START_TIMEOUT_MS);

  afterAll(async () => {
    await mongo?.stop();
  });

  it('stores one Source under the id get_price_reaction names, even when called at once', async () => {
    const { reaction } = await loadReactionFixture(DEMO_SOURCE_ID);
    const expected = nameUuid(sourceIdName('alpaca', priceReactionExternalId(reaction)));
    const now = new Date('2026-09-29T12:00:00Z');

    const ids = await Promise.all(
      Array.from({ length: 4 }, () => upsertPriceReactionSource(mongo.db, reaction, now)),
    );

    expect(new Set(ids)).toEqual(new Set([expected]));
    const stored = await collection(mongo.db, 'sources').find({ kind: 'market_data' }).toArray();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ provider: 'alpaca', tier: 1, createdAt: now });
  });
});
