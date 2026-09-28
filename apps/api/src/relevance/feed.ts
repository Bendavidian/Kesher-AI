import { randomUUID } from 'node:crypto';
import { FeedItem, MarketEvent, type Holding } from '@kesher/shared';
import { MongoServerError, type Db } from 'mongodb';
import { collection } from '../db/collections';
import { confidenceFor, type SourceTier } from './confidence';
import { loadEdges } from './graph';
import { bestPath, eventCompanies } from './score';

const DUPLICATE_KEY = 11000;

// Propagation and relevance for one extracted event, SPEC.md Pipeline: code only. Writes one
// FeedItem per user, relevance 0 included, so every persona sees the event at its own level.
// The graph is read once per event. Safe to run again: the unique (userId, eventId) index keeps
// one item per user, a rerun recomputes the scores in place, and _id, createdAt and the research
// state are written only on insert.
export async function scoreEvent(db: Db, eventId: string, now = new Date()): Promise<FeedItem[]> {
  const stored = await collection(db, 'market_events').findOne({ _id: eventId });
  if (!stored) throw new Error(`event ${eventId} not found`);
  const event = MarketEvent.parse(stored);
  if (!event.extraction) throw new Error(`event ${eventId} has no extraction to score`);

  const companies = eventCompanies(event.extraction.companies.map((company) => company.symbol));
  const edges = await loadEdges(db, companies);
  const sources = await collection(db, 'sources')
    .find({ _id: { $in: event.sourceIds } })
    .project<SourceTier>({ _id: 0, tier: 1, publisher: 1 })
    .toArray();
  const confidence = confidenceFor(sources);

  // Holdings only; the password hash never leaves the users collection.
  const users = await collection(db, 'users')
    .find({})
    .project<{ _id: string; holdings: Holding[] }>({ _id: 1, holdings: 1 })
    .sort({ _id: 1 })
    .toArray();

  const items = collection(db, 'feed_items');
  const written: FeedItem[] = [];
  for (const user of users) {
    const { relevance, path } = bestPath(
      companies,
      user.holdings.map((holding) => holding.symbol),
      edges,
    );
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
        { upsert: true, returnDocument: 'after' },
      );
    // Concurrent first upserts of one key can fail with E11000; the retry matches the winner.
    const stored = await upsert().catch((error: unknown) => {
      if (error instanceof MongoServerError && error.code === DUPLICATE_KEY) return upsert();
      throw error;
    });
    written.push(FeedItem.parse(stored));
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
