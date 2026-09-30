import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MONGO_START_TIMEOUT_MS, startTestMongo, type TestMongo } from '../test/mongo';
import { COLLECTION_NAMES } from './collections';
import { INDEXES, ensureCollections, ensureIndexes } from './indexes';

describe('ensureCollections and ensureIndexes on mongod', () => {
  let mongo: TestMongo;

  beforeAll(async () => {
    mongo = await startTestMongo('kesher_indexes_test');
  }, MONGO_START_TIMEOUT_MS);

  afterAll(async () => {
    await mongo?.stop();
  });

  it('creates every collection and can run again', async () => {
    await ensureCollections(mongo.db);
    await ensureCollections(mongo.db);

    const existing = await mongo.db.listCollections({}, { nameOnly: true }).toArray();
    expect(existing.map((c) => c.name).sort()).toEqual([...COLLECTION_NAMES].sort());
  });

  it('creates every index with its uniqueness and can run again', async () => {
    await ensureIndexes(mongo.db);
    await ensureIndexes(mongo.db);

    for (const name of COLLECTION_NAMES) {
      const created = await mongo.db.collection(name).indexes();
      for (const spec of INDEXES[name]) {
        const index = created.find((i) => i.name === spec.name);
        expect(index?.key, `${name}.${spec.name}`).toEqual(spec.key);
        expect(Boolean(index?.unique), `${name}.${spec.name} unique`).toBe(Boolean(spec.unique));
        expect(index?.expireAfterSeconds, `${name}.${spec.name} ttl`).toBe(spec.expireAfterSeconds);
      }
      // _id plus the declared indexes, nothing more.
      expect(created).toHaveLength(INDEXES[name].length + 1);
    }
  });
});
