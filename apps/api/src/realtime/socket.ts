import type { Server as HttpServer } from 'node:http';
import {
  SOCKET_EVENTS,
  type EventScored,
  type FeedCard,
  type FeedItem,
  type RunEnded,
  type RunStepPushed,
} from '@kesher/shared';
import type { Db } from 'mongodb';
import { Server } from 'socket.io';
import { sessionFromCookie } from '../auth/session';
import { assembleCards, feedCard } from '../feed/cards';
import type { ScoredItem } from '../relevance/feed';

// Socket.IO events the server sends (docs/INTERFACES.md). Dates travel as ISO strings.
export interface ServerToClientEvents {
  [SOCKET_EVENTS.feedItem]: (card: FeedCard) => void;
  [SOCKET_EVENTS.feedUpdate]: (card: FeedCard) => void;
  [SOCKET_EVENTS.eventScored]: (scored: EventScored) => void;
  [SOCKET_EVENTS.runStep]: (pushed: RunStepPushed) => void;
  [SOCKET_EVENTS.runEnd]: (ended: RunEnded) => void;
}

// The client sends nothing: every push is decided on the server.
type ClientToServerEvents = Record<string, never>;

interface SocketData {
  userId: string;
  // The session's expiry, in seconds since the epoch.
  exp: number;
}

export interface Realtime {
  // Pushes what one scoring run wrote: a card to each user whose item is above 0, then
  // event:scored to every signed in socket.
  publishScored(eventId: string, scored: readonly ScoredItem[]): Promise<void>;
  // Pushes feed:update to the item's user after its research state changed.
  publishItem(item: FeedItem): Promise<void>;
  // Pushes run:step and run:end to the run's own user only. userId is the run's stored user.
  publishRunStep(userId: string, pushed: RunStepPushed): void;
  publishRunEnd(userId: string, ended: RunEnded): void;
  // Disconnects every socket of a user that signed out, so none keeps receiving their cards.
  signOut(userId: string): void;
  close(): Promise<void>;
}

const roomOf = (userId: string) => `user:${userId}`;

// Attaches Socket.IO to the api's HTTP server. The handshake needs the session cookie, and the
// verified user decides the room; the client never names a user (principle 5).
export function createRealtime(httpServer: HttpServer, { db, secret }: { db: Db; secret: string }) {
  const io = new Server<
    ClientToServerEvents,
    ServerToClientEvents,
    Record<string, never>,
    SocketData
  >(httpServer, { serveClient: false });

  io.use((socket, next) => {
    void sessionFromCookie(secret, socket.handshake.headers.cookie).then((session) => {
      if (!session) {
        next(new Error('sign in required'));
        return;
      }
      socket.data.userId = session.sub;
      socket.data.exp = session.exp;
      next();
    }, next);
  });

  io.on('connection', (socket) => {
    void socket.join(roomOf(socket.data.userId));
    // The session was checked at the handshake only, so the socket ends when the session does.
    const expiry = setTimeout(
      () => socket.disconnect(true),
      Math.max(0, socket.data.exp * 1000 - Date.now()),
    );
    socket.once('disconnect', () => clearTimeout(expiry));
  });

  const realtime: Realtime = {
    async publishScored(eventId, scored) {
      // Relevance 0 never reaches a feed, so it is never pushed as a card.
      const shown = scored.filter(({ item }) => item.relevance > 0);
      const created = new Set(shown.filter((s) => s.created).map((s) => s.item._id));
      const cards = await assembleCards(
        db,
        shown.map((s) => s.item),
      );
      for (const card of cards) {
        const event = created.has(card.item._id)
          ? SOCKET_EVENTS.feedItem
          : SOCKET_EVENTS.feedUpdate;
        io.to(roomOf(card.item.userId)).emit(event, card);
      }
      // After the cards, so a client that got one never needs to ask why it has none.
      io.emit(SOCKET_EVENTS.eventScored, { eventId });
    },
    async publishItem(item) {
      if (item.relevance <= 0) return;
      const card = await feedCard(db, item);
      if (card) io.to(roomOf(item.userId)).emit(SOCKET_EVENTS.feedUpdate, card);
    },
    publishRunStep(userId, pushed) {
      io.to(roomOf(userId)).emit(SOCKET_EVENTS.runStep, pushed);
    },
    publishRunEnd(userId, ended) {
      io.to(roomOf(userId)).emit(SOCKET_EVENTS.runEnd, ended);
    },
    signOut(userId) {
      io.in(roomOf(userId)).disconnectSockets(true);
    },
    async close() {
      await io.close();
    },
  };
  return realtime;
}
