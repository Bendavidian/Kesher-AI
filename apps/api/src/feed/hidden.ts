import { EventExplain, FeedItem, HIDDEN_RECENT, HiddenFeed } from '@kesher/shared';
import type { Db } from 'mongodb';
import { collection } from '../db/collections';
import { assembleParts } from './cards';

// GET /feed/hidden (docs/INTERFACES.md): the user's most recent relevance 0 items, newest arrival
// first, as explanations, and how many relevance 0 items the user has (SPEC.md decision log, T23).
// It reads the stored FeedItems, the scores code wrote, like GET /feed; it writes nothing. The user
// id comes from the auth context only. An item whose event or source is gone is left out of recent
// and still counted.
export async function hiddenFeedFor(db: Db, userId: string): Promise<HiddenFeed> {
  const filter = { userId, relevance: 0 };
  const items = collection(db, 'feed_items');
  const [docs, total] = await Promise.all([
    items.find(filter).sort({ createdAt: -1, _id: 1 }).limit(HIDDEN_RECENT).toArray(),
    items.countDocuments(filter),
  ]);
  const stored = docs.map((doc) => FeedItem.parse(doc));
  const parts = await assembleParts(db, stored);
  const recent = stored.flatMap((item, index) => {
    const part = parts[index];
    return part
      ? [
          EventExplain.parse({
            ...part,
            relevance: item.relevance,
            path: item.path,
            confidence: item.confidence,
          }),
        ]
      : [];
  });
  // The two reads run apart, so an item scored between them could leave total one short.
  return HiddenFeed.parse({ recent, total: Math.max(total, recent.length) });
}
