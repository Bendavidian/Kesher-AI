import { z } from 'zod';
import { Id } from './domain/common';

// Socket.IO events (docs/INTERFACES.md). The server sends each one to the signed in user only,
// except event:scored, which names an event and carries nothing about any user.
export const SOCKET_EVENTS = {
  feedItem: 'feed:item',
  feedUpdate: 'feed:update',
  eventScored: 'event:scored',
} as const;

// An event was scored for every user. A client with no card for it can ask
// GET /events/:eventId/explain why it stays out of that user's feed.
export const EventScored = z.strictObject({ eventId: Id });
export type EventScored = z.infer<typeof EventScored>;
