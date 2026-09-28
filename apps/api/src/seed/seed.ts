import type { AnyBulkWriteOperation, Db } from 'mongodb';
import { collection, type CollectionName, type DocumentOf } from '../db/collections';
import { ensureCollections, ensureIndexes } from '../db/indexes';
import { buildCompanies, buildRelationships, buildSources, buildUsers } from './build';
import { FILINGS } from './config';

export interface UpsertCounts {
  upserted: number;
  modified: number;
  matched: number;
}

type SeedCollection = 'sources' | 'companies' | 'users' | 'relationships';
export type SeedCounts = Record<SeedCollection, UpsertCounts & { total: number }>;

// Upserts on the natural key. _id and the fields in insertOnly are written only when the
// document is new, so a rerun matches every document and modifies none.
async function upsert<N extends CollectionName>(
  db: Db,
  name: N,
  docs: DocumentOf<N>[],
  key: readonly (keyof DocumentOf<N> & string)[],
  insertOnly: readonly (keyof DocumentOf<N> & string)[] = [],
): Promise<UpsertCounts & { total: number }> {
  const onInsertKeys = new Set<string>(['_id', 'createdAt', ...insertOnly]);
  const operations = docs.map((doc) => {
    const fields = Object.entries(doc);
    return {
      updateOne: {
        filter: Object.fromEntries(key.map((k) => [k, doc[k]])),
        update: {
          $set: Object.fromEntries(fields.filter(([k]) => !onInsertKeys.has(k))),
          $setOnInsert: Object.fromEntries(fields.filter(([k]) => onInsertKeys.has(k))),
        },
        upsert: true,
      },
    };
  }) as AnyBulkWriteOperation<DocumentOf<N>>[];

  const target = collection(db, name);
  const result = await target.bulkWrite(operations, { ordered: true });
  return {
    upserted: result.upsertedCount,
    modified: result.modifiedCount,
    matched: result.matchedCount,
    total: await target.countDocuments(),
  };
}

// Seeds the personas, the demo universe, the filing sources and the reviewed edges. Safe to
// run again: unique indexes on the natural keys make duplicates impossible. Search indexes are
// not touched here; they need Atlas (see ensureSearchIndexes).
export async function runSeed(db: Db, now = new Date()): Promise<SeedCounts> {
  await ensureCollections(db);
  await ensureIndexes(db);

  const sources = await upsert(db, 'sources', buildSources(now), ['provider', 'externalId']);

  // Evidence must point at the stored Source ids, which a rerun keeps.
  const accessions = Object.values(FILINGS).map((f) => f.source.externalId);
  const stored = await collection(db, 'sources')
    .find({ provider: 'sec_edgar', externalId: { $in: accessions } })
    .project<{ _id: string; externalId: string }>({ _id: 1, externalId: 1 })
    .toArray();
  const sourceIds = new Map(stored.map((s) => [s.externalId, s._id]));

  return {
    sources,
    companies: await upsert(db, 'companies', buildCompanies(now), ['symbol']),
    users: await upsert(db, 'users', await buildUsers(now), ['email'], ['passwordHash']),
    relationships: await upsert(db, 'relationships', buildRelationships(now, sourceIds), [
      'from',
      'to',
      'type',
    ]),
  };
}
