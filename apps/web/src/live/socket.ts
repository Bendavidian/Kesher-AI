import { SOCKET_EVENTS, type FeedCard, type RunEnded, type RunStepPushed } from '@kesher/shared';
import { io } from 'socket.io-client';
import { decodeFeedCard, decodeRunEnded, decodeRunStep, decodeScored } from '../api/decode';

// Each screen listens to the pushes it shows.
export interface FeedSocketHandlers {
  // A card for the signed in user: new (feed:item) or changed (feed:update).
  onCard?: (card: FeedCard) => void;
  // An event was scored for every user (event:scored).
  onScored?: (eventId: string) => void;
  // A step one of the user's runs stored (run:step), and a run that ended (run:end).
  onRunStep?: (pushed: RunStepPushed) => void;
  onRunEnd?: (ended: RunEnded) => void;
  onConnection?: (connected: boolean) => void;
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
  // Decodes a push and hands it on; one that fails its schema is dropped.
  const listen = <T>(event: string, decode: (json: unknown) => T, handle?: (value: T) => void) => {
    if (!handle) return;
    socket.on(event, (json: unknown) => {
      let value: T;
      try {
        value = decode(json);
      } catch {
        return;
      }
      handle(value);
    });
  };
  listen(SOCKET_EVENTS.feedItem, decodeFeedCard, handlers.onCard);
  listen(SOCKET_EVENTS.feedUpdate, decodeFeedCard, handlers.onCard);
  listen(SOCKET_EVENTS.eventScored, (json) => decodeScored(json).eventId, handlers.onScored);
  listen(SOCKET_EVENTS.runStep, decodeRunStep, handlers.onRunStep);
  listen(SOCKET_EVENTS.runEnd, decodeRunEnded, handlers.onRunEnd);
  socket.on('connect', () => handlers.onConnection?.(true));
  socket.on('disconnect', () => handlers.onConnection?.(false));
  return { close: () => socket.close() };
};
