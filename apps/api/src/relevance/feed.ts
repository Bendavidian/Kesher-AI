import { randomUUID } from 'node:crypto';
import {
  FeedItem,
  MarketEvent,
  NO_RESEARCH,
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

// What scoring reads of a user: never the password hash. expiresAt only for a guest.
export interface ScoringUser {
  _id: string;
  holdings: Holding[];
  expiresAt?: Date;
}

// The users and FeedItems that count: every persona, and every guest whose expiresAt has not
// passed (SPEC.md decision log, T24). A guest the TTL monitor has not removed yet gets no new
// item and never leaves an event unscored. A guest's items carry its expiresAt, so the same
// filter counts only the items of users that count.
export const liveFilter = (now: Date) => ({
  $or: [{ expiresAt: { $exists: false } }, { expiresAt: { $gt: now } }],
});

// One user's FeedItem for the event, inserted or recomputed in place. _id, createdAt and the
// research state are written only on insert. createdAt is the scoring time, except for a guest's
// backfill, which passes the event's own.
async function upsertItem(
  db: Db,
  context: ScoringContext,
  user: ScoringUser,
  now: Date,
  createdAt: Date = now,
): Promise<ScoredItem> {
  const { event, confidence } = context;
  const { relevance, path } = scoreFor(context, user.holdings);
  const candidate = FeedItem.parse({
    _id: randomUUID(),
    userId: user._id,
    eventId: event._id,
    relevance,
    path,
    confidence,
    status: event.status,
    research: { ...NO_RESEARCH },
    createdAt,
    updatedAt: now,
    ...(user.expiresAt ? { expiresAt: user.expiresAt } : {}),
  });
  const { _id, research, userId, ...computed } = candidate;
  const { createdAt: insertedAt, ...changed } = computed;
  const items = collection(db, 'feed_items');
  const upsert = () =>
    items.findOneAndUpdate(
      { userId, eventId: event._id },
      { $set: changed, $setOnInsert: { _id, research, createdAt: insertedAt } },
      { upsert: true, returnDocument: 'after', includeResultMetadata: true },
    );
  // Concurrent first upserts of one key can fail with E11000; the retry matches the winner.
  const result = await upsert().catch((error: unknown) => {
    if (error instanceof MongoServerError && error.code === DUPLICATE_KEY) return upsert();
    throw error;
  });
  return {
    item: FeedItem.parse(result.value),
    created: result.lastErrorObject?.updatedExisting !== true,
  };
}

const scoringUsers = (db: Db, filter: object) =>
  collection(db, 'users')
    .find(filter)
    .project<ScoringUser>({ _id: 1, holdings: 1, expiresAt: 1 })
    .sort({ _id: 1 })
    .toArray();

// Propagation and relevance for one extracted event, SPEC.md Pipeline: code only. Writes one
// FeedItem per user, relevance 0 included, so the event counts as scored for every user; the feed
// hides relevance 0. The graph is read once per event. Safe to run again: the unique (userId,
// eventId) index keeps one item per user, a rerun recomputes the scores in place, and _id,
// createdAt and the research state are written only on insert.
export async function scoreEvent(db: Db, eventId: string, now = new Date()): Promise<ScoredItem[]> {
  const context = await loadScoringContext(db, eventId);
  const written: ScoredItem[] = [];
  for (const user of await scoringUsers(db, liveFilter(now))) {
    written.push(await upsertItem(db, context, user, now));
  }
  return written;
}

// How many events a guest's backfill reads and scores at once.
const BACKFILL_CONCURRENCY = 8;

// Every stored extracted event for one user, with the same scoring and no model call (SPEC.md
// decision log, T24): a new guest's feed is full at once, and a guest who changes holdings is
// rescored in place with its research state kept. Each new item takes the time its event arrived
// in the personas' feeds (their newest item, else the event's createdAt), so the arrival order
// (T23) matches a persona's, a replayed card included. An event whose extraction is gone in
// between is skipped.
export async function scoreUser(db: Db, user: ScoringUser, now = new Date()): Promise<number> {
  const events = await collection(db, 'market_events')
    .find({ extraction: { $ne: null } })
    .project<{ _id: string; createdAt: Date }>({ _id: 1, createdAt: 1 })
    .sort({ createdAt: -1, _id: 1 })
    .toArray();
  const arrivals = new Map(
    (
      await collection(db, 'feed_items')
        .aggregate<{ _id: string; arrivedAt: Date }>([
          { $match: { eventId: { $in: events.map((e) => e._id) }, expiresAt: { $exists: false } } },
          { $group: { _id: '$eventId', arrivedAt: { $max: '$createdAt' } } },
        ])
        .toArray()
    ).map((row) => [row._id, row.arrivedAt]),
  );
  let scored = 0;
  for (let start = 0; start < events.length; start += BACKFILL_CONCURRENCY) {
    const batch = events.slice(start, start + BACKFILL_CONCURRENCY);
    await Promise.all(
      batch.map(async (event) => {
        let context: ScoringContext;
        try {
          context = await loadScoringContext(db, event._id);
        } catch (error) {
          if (error instanceof EventNotScorableError) return;
          throw error;
        }
        await upsertItem(db, context, user, now, arrivals.get(event._id) ?? event.createdAt);
        scored += 1;
      }),
    );
  }
  return scored;
}

// An event is scored once every user that counts has its FeedItem. A scoring run that stopped
// partway, or a user added since, leaves the event unscored, and the next try completes it with
// no model call.
export async function isScored(db: Db, eventId: string, now = new Date()): Promise<boolean> {
  const [users, items] = await Promise.all([
    collection(db, 'users').countDocuments(liveFilter(now)),
    collection(db, 'feed_items').countDocuments({ eventId, ...liveFilter(now) }),
  ]);
  return items >= users;
}
