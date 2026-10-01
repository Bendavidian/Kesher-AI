import { EMBEDDING_DIMENSIONS } from '@kesher/shared';
import {
  MongoServerError,
  type Db,
  type IndexDescription,
  type SearchIndexDescription,
} from 'mongodb';
import { COLLECTION_NAMES, type CollectionName } from './collections';

// Unique indexes on natural keys make duplicates impossible, whatever writes them.
export const INDEXES: Record<CollectionName, IndexDescription[]> = {
  users: [{ name: 'email_unique', key: { email: 1 }, unique: true }],
  companies: [
    { name: 'symbol_unique', key: { symbol: 1 }, unique: true },
    { name: 'cik_unique', key: { cik: 1 }, unique: true },
  ],
  // The from prefix also serves $graphLookup, which matches edges on from.
  relationships: [{ name: 'edge_unique', key: { from: 1, to: 1, type: 1 }, unique: true }],
  sources: [
    { name: 'provider_external_id_unique', key: { provider: 1, externalId: 1 }, unique: true },
    { name: 'published_at', key: { publishedAt: -1 } },
  ],
  market_events: [
    // Multikey: a source belongs to at most one event cluster.
    { name: 'source_ids_unique', key: { sourceIds: 1 }, unique: true },
    { name: 'published_at', key: { publishedAt: -1 } },
  ],
  feed_items: [
    { name: 'user_event_unique', key: { userId: 1, eventId: 1 }, unique: true },
    { name: 'user_created_at', key: { userId: 1, createdAt: -1 } },
  ],
  agent_runs: [
    { name: 'user_created_at', key: { userId: 1, createdAt: -1 } },
    { name: 'event', key: { eventId: 1 } },
    // The research gate's recent run check, per user and event (T12).
    { name: 'user_event_created_at', key: { userId: 1, eventId: 1, createdAt: -1 } },
  ],
  reports: [{ name: 'run_unique', key: { runId: 1 }, unique: true }],
  claims: [{ name: 'report', key: { reportId: 1 } }],
  filing_chunks: [
    { name: 'source_chunk_unique', key: { sourceId: 1, chunkIndex: 1 }, unique: true },
  ],
  // One counter per UTC day, mode and drop reason; incremented with $inc.
  ingest_counters: [
    { name: 'day_mode_reason_unique', key: { day: 1, mode: 1, reason: 1 }, unique: true },
  ],
  // One recording per live item; the first one is kept.
  recordings: [
    { name: 'provider_external_id_unique', key: { provider: 1, externalId: 1 }, unique: true },
  ],
  // One budget per UTC day; runs are reserved with a conditional $inc.
  research_budget: [{ name: 'day_unique', key: { day: 1 }, unique: true }],
  // One live extraction budget per UTC day, reserved the same way (T19).
  ingest_budget: [{ name: 'day_unique', key: { day: 1 }, unique: true }],
};

const embeddingField = {
  type: 'vector',
  path: 'embedding',
  numDimensions: EMBEDDING_DIMENSIONS,
  similarity: 'cosine',
} as const;

// Atlas only. The free tier allows 3 search indexes, and these are all three: event vectors and
// filing chunk vectors, and the text index behind search_news (SPEC.md decision log, T13).
// Scores only rank results and never act as a threshold (principle 3).
export const SEARCH_INDEXES = [
  {
    collection: 'market_events',
    index: {
      name: 'market_events_vector',
      type: 'vectorSearch',
      definition: { fields: [embeddingField] },
    },
  },
  {
    collection: 'filing_chunks',
    index: {
      name: 'filing_chunks_vector',
      type: 'vectorSearch',
      definition: { fields: [embeddingField, { type: 'filter', path: 'symbol' }] },
    },
  },
  {
    collection: 'sources',
    index: {
      name: 'sources_text',
      type: 'search',
      definition: {
        mappings: {
          dynamic: false,
          fields: {
            title: { type: 'string' },
            text: { type: 'string' },
            kind: { type: 'token' },
            symbols: { type: 'token' },
            publishedAt: { type: 'date' },
          },
        },
      },
    },
  },
] as const satisfies readonly { collection: CollectionName; index: SearchIndexDescription }[];

const NAMESPACE_EXISTS = 48;

export async function ensureCollections(db: Db): Promise<void> {
  const existing = await db.listCollections({}, { nameOnly: true }).toArray();
  const names = new Set(existing.map((c) => c.name));
  for (const name of COLLECTION_NAMES) {
    if (names.has(name)) continue;
    try {
      await db.createCollection(name);
    } catch (error) {
      // Another machine created it in the meantime.
      if (!(error instanceof MongoServerError && error.code === NAMESPACE_EXISTS)) throw error;
    }
  }
}

export async function ensureIndexes(db: Db): Promise<void> {
  for (const name of COLLECTION_NAMES) {
    await db.collection(name).createIndexes(INDEXES[name]);
  }
}

export interface SearchIndexResult {
  collection: CollectionName;
  name: string;
  created: boolean;
  status: string;
}

// Creates each search index that is missing by name, without waiting for it to become
// queryable. Needs Atlas: plain mongod has no search index commands.
export async function ensureSearchIndexes(db: Db): Promise<SearchIndexResult[]> {
  const results: SearchIndexResult[] = [];
  for (const { collection, index } of SEARCH_INDEXES) {
    const target = db.collection(collection);
    const [existing] = await target.listSearchIndexes(index.name).toArray();
    if (!existing) await target.createSearchIndex(index);
    results.push({
      collection,
      name: index.name,
      created: !existing,
      status: existing && 'status' in existing ? String(existing.status) : 'PENDING',
    });
  }
  return results;
}
