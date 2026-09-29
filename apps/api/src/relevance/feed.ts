import { randomUUID } from 'node:crypto';
import {
  FeedItem,
  MarketEvent,
  type Confidence,
  type Holding,
  type Relationship,
  type UniverseSymbol,
} from '@kesher/shared';
import { MongoServerError, type Db } from 'mongodb';
import { collection } from '../db/collections';
import { confidenceFor, type SourceTier } from './confidence';
import { loadEdges } from './graph';
import { bestPath, eventCompanies, type Scored } from './score';

const DUPLICATE_KEY = 11000;

// Everything relevance needs for one extracted event, read once: the provider tagged universe
// companies it starts from, the reviewed edges around them and the confidence of its sources.
export interface ScoringContext {
  event: MarketEvent;
  companies: UniverseSymbol[];
  edges: Relationship[];
  confidence: Confidence;
}

// The event is missing or has no extraction yet, so there is nothing to score.
export class EventNotScorableError extends Error {
  constructor(eventId: string, reason: 'not found' | 'has no extraction to score') {
    super(`event ${eventId} ${reason}`);
    this.name = 'EventNotScorableError';
  }
}

export async function loadScoringContext(db: Db, eventId: string): Promise<ScoringContext> {
  const stored = await collection(db, 'market_events').findOne({ _id: eventId });
  if (!stored) throw new EventNotScorableError(eventId, 'not found');
  const event = MarketEvent.parse(stored);
  if (!event.extraction) throw new EventNotScorableError(eventId, 'has no extraction to score');

  const sources = await collection(db, 'sources')
    .find({ _id: { $in: event.sourceIds } })
    .project<SourceTier & { symbols: string[] }>({ _id: 0, tier: 1, publisher: 1, symbols: 1 })
    .toArray();
  const companies = eventCompanies(
    event.extraction.companies.map((company) => company.symbol),
    sources.flatMap((source) => source.symbols),
  );
  return {
    event,
    companies,
    edges: await loadEdges(db, companies),
    confidence: confidenceFor(sources),
  };
}

// One user's relevance and path for the event. Pure; the same call scores and explains.
export function scoreFor(context: ScoringContext, holdings: readonly Holding[]): Scored {
  return bestPath(
    context.companies,
    holdings.map((holding) => holding.symbol),
    context.edges,
  );
}

// A FeedItem scoreEvent wrote, and whether this run inserted it (feed:item) or updated it
// (feed:update).
export interface ScoredItem {
  item: FeedItem;
  created: boolean;
}

// Propagation and relevance for one extracted event, SPEC.md Pipeline: code only. Writes one
// FeedItem per user, relevance 0 included, so the event counts as scored for every user; the feed
// hides relevance 0. The graph is read once per event. Safe to run again: the unique (userId,
// eventId) index keeps one item per user, a rerun recomputes the scores in place, and _id,
// createdAt and the research state are written only on insert.
export async function scoreEvent(db: Db, eventId: string, now = new Date()): Promise<ScoredItem[]> {
  const context = await loadScoringContext(db, eventId);
  const { event, confidence } = context;

  // Holdings only; the password hash never leaves the users collection.
  const users = await collection(db, 'users')
    .find({})
    .project<{ _id: string; holdings: Holding[] }>({ _id: 1, holdings: 1 })
    .sort({ _id: 1 })
    .toArray();

  const items = collection(db, 'feed_items');
  const written: ScoredItem[] = [];
  for (const user of users) {
    const { relevance, path } = scoreFor(context, user.holdings);
    const candidate = FeedItem.parse({
      _id: randomUUID(),
      userId: user._id,
      eventId: event._id,
      relevance,
      path,
      confidence,
      status: event.status,
      research: { state: 'none', runId: null },
      createdAt: now,
      updatedAt: now,
    });
    const { _id, research, createdAt, userId, ...computed } = candidate;
    const upsert = () =>
      items.findOneAndUpdate(
        { userId, eventId: event._id },
        { $set: computed, $setOnInsert: { _id, research, createdAt } },
        { upsert: true, returnDocument: 'after', includeResultMetadata: true },
      );
    // Concurrent first upserts of one key can fail with E11000; the retry matches the winner.
    const result = await upsert().catch((error: unknown) => {
      if (error instanceof MongoServerError && error.code === DUPLICATE_KEY) return upsert();
      throw error;
    });
    written.push({
      item: FeedItem.parse(result.value),
      created: result.lastErrorObject?.updatedExisting !== true,
    });
  }
  return written;
}

// An event is scored once every user has its FeedItem. A scoring run that stopped partway, or a
// user added since, leaves the event unscored, and the next try completes it with no model call.
export async function isScored(db: Db, eventId: string): Promise<boolean> {
  const [users, items] = await Promise.all([
    collection(db, 'users').countDocuments(),
    collection(db, 'feed_items').countDocuments({ eventId }),
  ]);
  return items >= users;
}
