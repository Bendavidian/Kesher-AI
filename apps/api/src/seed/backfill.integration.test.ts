import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MONGO_START_TIMEOUT_MS, startTestMongo, type TestMongo } from '../test/mongo';
import { backfillPublishers } from './backfill';

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
