import { SOCKET_EVENTS, type FeedCard } from '@kesher/shared';
import { io } from 'socket.io-client';
import { decodeFeedCard, decodeScored } from '../api/decode';

export interface FeedSocketHandlers {
  // A card for the signed in user: new (feed:item) or changed (feed:update).
  onCard(card: FeedCard): void;
  // An event was scored for every user (event:scored).
  onScored(eventId: string): void;
  onConnection(connected: boolean): void;
}

export interface FeedSocket {
  close(): void;
}

export type ConnectFeed = (handlers: FeedSocketHandlers) => FeedSocket;

// Opens Socket.IO on the page's own origin; the dev server proxies /socket.io to the api. The
// session cookie rides on the handshake, so connect after signing in. Pushes are untrusted input
// like any response: one that fails its schema is dropped.
export const connectFeed: ConnectFeed = (handlers) => {
  const socket = io({ transports: ['websocket'], withCredentials: true });
  const onCard = (json: unknown) => {
    try {
      handlers.onCard(decodeFeedCard(json));
    } catch {
      // Not a FeedCard; nothing to show.
    }
  };
  socket.on(SOCKET_EVENTS.feedItem, onCard);
  socket.on(SOCKET_EVENTS.feedUpdate, onCard);
  socket.on(SOCKET_EVENTS.eventScored, (json: unknown) => {
    try {
      handlers.onScored(decodeScored(json).eventId);
    } catch {
      // Not an event id.
    }
  });
  socket.on('connect', () => handlers.onConnection(true));
  socket.on('disconnect', () => handlers.onConnection(false));
  return { close: () => socket.close() };
};
