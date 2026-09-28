import { randomUUID } from 'node:crypto';
import { MongoServerError } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { COLLECTION_NAMES, SCHEMA_BY_COLLECTION, collection } from '../db/collections';
import { MONGO_START_TIMEOUT_MS, startTestMongo, type TestMongo } from '../test/mongo';
import { runSeed, type SeedCounts } from './seed';

const EXPECTED_TOTALS = { sources: 4, companies: 17, users: 3, relationships: 12 };

describe('runSeed on mongod', () => {
  let mongo: TestMongo;
  let first: SeedCounts;
  let second: SeedCounts;
  const idsAfterFirst: Record<string, string[]> = {};

  const ids = async (name: (typeof COLLECTION_NAMES)[number]) =>
    (
      await mongo.db
        .collection(name)
        .find({}, { projection: { _id: 1 } })
        .toArray()
    )
      .map((d) => String(d._id))
      .sort();

  beforeAll(async () => {
    mongo = await startTestMongo('kesher_seed_test');
    first = await runSeed(mongo.db);
    for (const name of Object.keys(EXPECTED_TOTALS)) {
      idsAfterFirst[name] = await ids(name as keyof typeof EXPECTED_TOTALS);
    }
    second = await runSeed(mongo.db, new Date(Date.now() + 60_000));
  }, MONGO_START_TIMEOUT_MS);

  afterAll(async () => {
    await mongo?.stop();
  });

  it('inserts everything on the first run', () => {
    for (const [name, total] of Object.entries(EXPECTED_TOTALS)) {
      const counts = first[name as keyof SeedCounts];
      expect(counts, name).toEqual({ upserted: total, modified: 0, matched: 0, total });
    }
  });

  it('changes nothing on the second run', () => {
    for (const [name, total] of Object.entries(EXPECTED_TOTALS)) {
      const counts = second[name as keyof SeedCounts];
      expect(counts, name).toEqual({ upserted: 0, modified: 0, matched: total, total });
    }
  });

  it('keeps every _id across runs', async () => {
    for (const name of Object.keys(EXPECTED_TOTALS)) {
      expect(await ids(name as keyof typeof EXPECTED_TOTALS), name).toEqual(idsAfterFirst[name]);
    }
  });

  it('rejects a duplicate company or edge through the unique indexes', async () => {
    const tsm = await collection(mongo.db, 'companies').findOne({ symbol: 'TSM' });
    const edge = await collection(mongo.db, 'relationships').findOne({ from: 'TSM', to: 'NVDA' });
    const duplicates = [
      () => collection(mongo.db, 'companies').insertOne({ ...tsm!, _id: randomUUID() }),
      () => collection(mongo.db, 'relationships').insertOne({ ...edge!, _id: randomUUID() }),
    ];
    for (const insert of duplicates) {
      await expect(insert()).rejects.toSatisfy(
        (e) => e instanceof MongoServerError && e.code === 11000,
      );
    }
  });

  it('stores only documents that pass their strict schema', async () => {
    for (const name of COLLECTION_NAMES) {
      const docs = await mongo.db.collection(name).find().toArray();
      for (const doc of docs) {
        const result = SCHEMA_BY_COLLECTION[name].safeParse(doc);
        expect(result.success, `${name} ${String(doc._id)}`).toBe(true);
      }
    }
  });

  it('keeps each edge next to its inverse and its evidence on a stored source', async () => {
    const edges = await collection(mongo.db, 'relationships').find().toArray();
    const sourceIds = new Set(await ids('sources'));
    const inverse = { supplier_of: 'customer_of', customer_of: 'supplier_of' } as const;
    for (const edge of edges) {
      const type = edge.type === 'competitor_of' ? edge.type : inverse[edge.type];
      const match = edges.find((e) => e.from === edge.to && e.to === edge.from && e.type === type);
      expect(match, `${edge.from} ${edge.type} ${edge.to}`).toBeDefined();
      expect(match?.evidence).toEqual(edge.evidence);
      expect(sourceIds.has(edge.evidence.sourceId)).toBe(true);
    }
  });
});
