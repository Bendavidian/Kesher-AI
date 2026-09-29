import { EventExplain } from '@kesher/shared';
import type { Db } from 'mongodb';
import { collection } from '../db/collections';
import { EventNotScorableError, loadScoringContext, scoreFor } from '../relevance/feed';
import { assembleParts } from './cards';

// GET /events/:eventId/explain (docs/INTERFACES.md): the user's relevance and path for one event,
// computed on request by the same code that scores the feed. Reads only; it writes nothing, not
// even a FeedItem. null when the event is unknown or not extracted yet. The user id comes from
// the auth context only.
export async function explainEvent(
  db: Db,
  eventId: string,
  userId: string,
): Promise<EventExplain | null> {
  const user = await collection(db, 'users').findOne(
    { _id: userId },
    // Holdings only; the password hash never leaves the users collection.
    { projection: { _id: 0, holdings: 1 } },
  );
  if (!user) return null;

  const context = await loadScoringContext(db, eventId).catch((error: unknown) => {
    if (error instanceof EventNotScorableError) return null;
    throw error;
  });
  if (!context) return null;

  const { relevance, path } = scoreFor(context, user.holdings);
  const [parts] = await assembleParts(db, [{ eventId, path }]);
  if (!parts) return null;
  return EventExplain.parse({ ...parts, relevance, path, confidence: context.confidence });
}
