import type {
  EventExplain,
  FeedCard,
  FeedCardEvent,
  FeedCardSource,
  PersonaKey,
} from '@kesher/shared';
import {
  DEMO_EVENT,
  DEMO_NEWS_SOURCE,
  FEED_ITEMS,
  NVDA_10K_SOURCE_ID,
  RELATIONSHIPS,
} from './demoEvent';

// The demo event as the api sends it: FeedCards for A and B, and C's explanation, which no feed
// list carries (relevance 0). Built from the demoEvent fixtures, so both views stay in step.

const cardEvent: FeedCardEvent = {
  _id: DEMO_EVENT._id,
  sourceIds: DEMO_EVENT.sourceIds,
  headline: DEMO_EVENT.headline,
  publishedAt: DEMO_EVENT.publishedAt,
  status: DEMO_EVENT.status,
  extraction: DEMO_EVENT.extraction,
  createdAt: DEMO_EVENT.createdAt,
};

export const DEMO_CARD_SOURCE: FeedCardSource = {
  _id: DEMO_NEWS_SOURCE._id,
  provider: 'alpaca',
  kind: 'news',
  tier: 2,
  externalId: DEMO_NEWS_SOURCE.externalId,
  url: 'https://www.benzinga.com/news/24/04/38062166/taiwan-shaken-by-massive-7-2-magnitude-earthquake-forcing-tsmc-to-suspend-chip-production',
  publisher: 'Benzinga',
  title: DEMO_EVENT.headline,
  publishedAt: DEMO_NEWS_SOURCE.publishedAt,
  injectionScreen: null,
};

const edge = RELATIONSHIPS[0]!;

function card(key: 'A' | 'B'): FeedCard {
  const item = FEED_ITEMS[key][0]!;
  return {
    item,
    event: cardEvent,
    source: DEMO_CARD_SOURCE,
    evidence:
      item.path?.hops.map(() => ({
        relationshipId: edge._id,
        from: edge.from,
        to: edge.to,
        type: edge.type,
        quote: edge.evidence.quote,
        filingDate: edge.evidence.filingDate,
        url: edge.evidence.url,
        reviewed: true as const,
        filing: {
          sourceId: NVDA_10K_SOURCE_ID,
          symbol: 'NVDA' as const,
          title: 'NVIDIA Corp 10-K for the fiscal year ended 2026-01-25',
          form: '10-K' as const,
          tier: 1 as const,
        },
      })) ?? [],
    priceReaction: null,
  };
}

export const DEMO_CARDS: Record<PersonaKey, FeedCard[]> = {
  A: [card('A')],
  B: [card('B')],
  // Relevance 0 never reaches a feed list.
  C: [],
};

// What GET /events/:eventId/explain answers for the demo event, per persona.
export const DEMO_EXPLAINS: Record<PersonaKey, EventExplain> = {
  A: { ...pick(DEMO_CARDS.A[0]!) },
  B: { ...pick(DEMO_CARDS.B[0]!) },
  C: {
    event: cardEvent,
    source: DEMO_CARD_SOURCE,
    relevance: 0,
    path: null,
    confidence: 'medium',
    evidence: [],
  },
};

function pick({ item, event, source, evidence }: FeedCard): EventExplain {
  return {
    event,
    source,
    relevance: item.relevance,
    path: item.path,
    confidence: item.confidence,
    evidence,
  };
}
