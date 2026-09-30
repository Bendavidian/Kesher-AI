import type { FeedCard, HiddenFeed, PersonaKey, PublicUser } from '@kesher/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLiveDeps } from './deps';
import type { FeedSocket } from './socket';

export type LiveStatus = 'signing_in' | 'ready' | 'error';

export interface LiveFeed {
  status: LiveStatus;
  user: PublicUser | null;
  // FeedCards, relevance above 0, one per event.
  cards: FeedCard[];
  // The most recent scored events that stay out of this user's feed (relevance 0), explained,
  // and how many there are (GET /feed/hidden).
  hidden: HiddenFeed;
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
  hidden: { recent: [], total: 0 },
  connected: false,
};

// The state of one persona's session. A switch starts from START without resetting in the effect.
interface Session extends LiveFeed {
  persona: PersonaKey;
}

// One card per event: a push replaces the card it updates, and a reset and replay gives the same
// event a new FeedItem.
export function upsertCard(cards: readonly FeedCard[], card: FeedCard): FeedCard[] {
  return [card, ...cards.filter((c) => c.event._id !== card.event._id)];
}

// Signs in as the persona, loads GET /feed and GET /feed/hidden, and keeps them live over
// Socket.IO: after each scored event it reads the hidden items again, so an event with no path
// shows as None (SPEC.md decision log, T23).
export function useLiveFeed(
  personaKey: PersonaKey,
  onScored: (eventId: string) => void,
): LiveFeedControls {
  const { api, connectFeed } = useLiveDeps();
  const [session, setSession] = useState<Session>({ ...START, persona: personaKey });

  // Read by socket handlers, which outlive a render.
  const cardsRef = useRef<FeedCard[]>([]);
  // Set once the current persona signed in; a card from before a switch is dropped.
  const upsertRef = useRef<(card: FeedCard) => void>(() => undefined);
  const onScoredRef = useRef(onScored);
  useEffect(() => {
    onScoredRef.current = onScored;
  });

  useEffect(() => {
    let active = true;
    let socket: FeedSocket | undefined;
    cardsRef.current = [];
    // Updates this persona's session; one left from the previous persona is dropped.
    const setState = (update: (s: LiveFeed) => LiveFeed) =>
      setSession((s) => {
        const current = s.persona === personaKey ? s : START;
        return { ...update(current), persona: personaKey };
      });

    const setCards = (cards: FeedCard[]) => {
      cardsRef.current = cards;
      setState((s) => ({ ...s, cards }));
    };

    upsertRef.current = () => undefined;

    // Reads rarely overlap, but only the latest answer is kept.
    let hiddenReads = 0;
    const loadHidden = async () => {
      const read = ++hiddenReads;
      const hidden = await api.hidden();
      if (active && read === hiddenReads) setState((s) => ({ ...s, hidden }));
    };
    const refreshHidden = () => {
      loadHidden().catch(() => {
        // The hidden list stays as it is.
      });
    };

    void (async () => {
      try {
        const user = await api.signInAs(personaKey);
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
            refreshHidden();
          },
          onConnection: (connected) => {
            if (active) setState((s) => ({ ...s, connected }));
          },
        });
        // A hidden list that fails to load leaves the feed usable, with nothing hidden shown.
        const [loaded] = await Promise.all([api.feed(), loadHidden().catch(() => undefined)]);
        if (!active) return;
        // Cards pushed while the feed loaded are newer than the ones it returned.
        const pushed = cardsRef.current;
        setCards(pushed.reduceRight(upsertCard, loaded));
        setState((s) => ({ ...s, status: 'ready', user }));
      } catch {
        if (active) setState((s) => ({ ...s, status: 'error' }));
      }
    })();

    return () => {
      active = false;
      socket?.close();
    };
  }, [personaKey, api, connectFeed]);

  const upsert = useCallback((card: FeedCard) => upsertRef.current(card), []);
  return { ...(session.persona === personaKey ? session : START), upsert };
}
