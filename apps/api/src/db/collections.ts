import {
  AgentRun,
  Claim,
  Company,
  FeedItem,
  FilingChunk,
  IngestCounter,
  LiveRecording,
  MarketEvent,
  Relationship,
  Report,
  Source,
  User,
} from '@kesher/shared';
import type { Collection, Db } from 'mongodb';
import type { z } from 'zod';

// Every collection with the schema its documents must satisfy (docs/SPEC.md Domain model).
export const SCHEMA_BY_COLLECTION = {
  users: User,
  companies: Company,
  relationships: Relationship,
  sources: Source,
  market_events: MarketEvent,
  feed_items: FeedItem,
  agent_runs: AgentRun,
  reports: Report,
  claims: Claim,
  filing_chunks: FilingChunk,
  ingest_counters: IngestCounter,
  recordings: LiveRecording,
} as const;

export type CollectionName = keyof typeof SCHEMA_BY_COLLECTION;
export const COLLECTION_NAMES = Object.keys(SCHEMA_BY_COLLECTION) as CollectionName[];

export type DocumentOf<N extends CollectionName> = z.infer<(typeof SCHEMA_BY_COLLECTION)[N]>;

export function collection<N extends CollectionName>(db: Db, name: N): Collection<DocumentOf<N>> {
  return db.collection<DocumentOf<N>>(name);
}
