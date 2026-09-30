import type { EventExplain, FeedCard, PublicUser } from '@kesher/shared';
import type { Viewer } from '../view/types';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLiveDeps } from './deps';
import type { FeedSocket } from './socket';

export type LiveStatus = 'signing_in' | 'ready' | 'error';

export interface LiveFeed {
  status: LiveStatus;
  user: PublicUser | null;
  // FeedCards, relevance above 0, one per event.
  cards: FeedCard[];
  // Scored events that stay out of this user's feed, explained on request (relevance 0).
  explains: EventExplain[];
  connected: boolean;
}

export interface LiveFeedControls extends LiveFeed {
  // Applies a card the api answered with, as a push would.
  upsert(card: FeedCard): void;
}

const START: LiveFeed = {
  status: 'signing_in',
  user: null,
  cards: [],
  explains: [],
  connected: false,
};

// The state of one viewer's session. A switch starts from START without resetting in the effect.
interface Session extends LiveFeed {
  viewer: string;
}

const viewerId = (viewer: Viewer | null) => (viewer ? `${viewer.key}:${viewer.session}` : '');

// One card per event: a push replaces the card it updates, and a reset and replay gives the same
// event a new FeedItem.
export function upsertCard(cards: readonly FeedCard[], card: FeedCard): FeedCard[] {
  return [card, ...cards.filter((c) => c.event._id !== card.event._id)];
}

// Signs in as the persona, loads GET /feed and keeps it live over Socket.IO. When an event is
// scored and no card for it arrives, it asks explain why, so the event shows as None. The last
// scored event lives above the screen, so switching persona explains it for the new persona too.
// A guest is already signed in by the cookie POST /guest set, so it only reads GET /me. A null
// viewer waits: the app is still finding out whether the cookie is a guest's.
export function useLiveFeed(
  viewer: Viewer | null,
  lastScoredEventId: string | null,
  onScored: (eventId: string) => void,
): LiveFeedControls {
  const { api, connectFeed } = useLiveDeps();
  const current = viewerId(viewer);
  const key = viewer?.key;
  const [session, setSession] = useState<Session>({ ...START, viewer: current });

  // Read by socket handlers, which outlive a render.
  const cardsRef = useRef<FeedCard[]>([]);
  // Set once the current persona signed in; a card from before a switch is dropped.
  const upsertRef = useRef<(card: FeedCard) => void>(() => undefined);
  const lastScoredRef = useRef(lastScoredEventId);
  const onScoredRef = useRef(onScored);
  useEffect(() => {
    lastScoredRef.current = lastScoredEventId;
    onScoredRef.current = onScored;
  });

  useEffect(() => {
    if (!key) return;
    let active = true;
    let socket: FeedSocket | undefined;
    cardsRef.current = [];
    // Updates this viewer's session; one left from the previous viewer is dropped.
    const setState = (update: (s: LiveFeed) => LiveFeed) =>
      setSession((s) => {
        const mine = s.viewer === current ? s : START;
        return { ...update(mine), viewer: current };
      });

    const setCards = (cards: FeedCard[]) => {
      cardsRef.current = cards;
      const shown = new Set(cards.map((card) => card.event._id));
      setState((s) => ({
        ...s,
        cards,
        explains: s.explains.filter((explain) => !shown.has(explain.event._id)),
      }));
    };

    upsertRef.current = () => undefined;

    const explainHidden = async (eventId: string) => {
      const carded = () => cardsRef.current.some((card) => card.event._id === eventId);
      if (carded()) return;
      try {
        const explain = await api.explain(eventId);
        // Above 0 means its card is on the way; only None belongs in the hidden list.
        if (!active || carded() || explain.relevance > 0) return;
        setState((s) => ({
          ...s,
          explains: [explain, ...s.explains.filter((e) => e.event._id !== eventId)],
        }));
      } catch {
        // Nothing to explain; the feed stays as it is.
      }
    };

    void (async () => {
      try {
        const user = await (key === 'guest' ? api.me() : api.signInAs(key));
        if (!active) return;
        // Only this user's cards: an answer that arrives after a switch is dropped.
        upsertRef.current = (card) => {
          if (active && card.item.userId === user._id) setCards(upsertCard(cardsRef.current, card));
        };
        // After sign in, so the handshake carries this persona's cookie.
        socket = connectFeed({
          onCard: (card) => {
            if (active) setCards(upsertCard(cardsRef.current, card));
          },
          onScored: (eventId) => {
            if (!active) return;
            onScoredRef.current(eventId);
            void explainHidden(eventId);
          },
          onConnection: (connected) => {
            if (active) setState((s) => ({ ...s, connected }));
          },
        });
        const loaded = await api.feed();
        if (!active) return;
        // Cards pushed while the feed loaded are newer than the ones it returned.
        const pushed = cardsRef.current;
        setCards(pushed.reduceRight(upsertCard, loaded));
        setState((s) => ({ ...s, status: 'ready', user }));
        if (lastScoredRef.current) await explainHidden(lastScoredRef.current);
      } catch {
        if (active) setState((s) => ({ ...s, status: 'error' }));
      }
    })();

    return () => {
      active = false;
      socket?.close();
    };
  }, [current, key, api, connectFeed]);

  const upsert = useCallback((card: FeedCard) => upsertRef.current(card), []);
  return { ...(session.viewer === current ? session : START), upsert };
}
