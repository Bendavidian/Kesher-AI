import { z } from 'zod';
import {
  Confidence,
  Embedding,
  Id,
  Importance,
  LlmProvider,
  NonBlank,
  Relevance,
  Theme,
  Ticker,
} from './common';
import { RelationshipType } from './graph';
import { UniverseSymbol } from './universe';

export const EventStatus = z.enum(['unconfirmed', 'confirmed']);
export type EventStatus = z.infer<typeof EventStatus>;

export const Impact = z.enum(['positive', 'negative', 'neutral', 'unclear']);
export type Impact = z.infer<typeof Impact>;

// The event types validated in the T00 spike; T04 owns the extraction prompt.
export const EVENT_TYPES = [
  'natural_disaster',
  'production_disruption',
  'earnings',
  'guidance',
  'regulatory',
  'm_and_a',
  'product',
  'legal',
  'macro',
  'other',
] as const;
export const EventType = z.enum(EVENT_TYPES);
export type EventType = z.infer<typeof EventType>;

// The model's structured output, with the provider and model that produced it.
export const Extraction = z.strictObject({
  companies: z.array(z.strictObject({ symbol: Ticker, impact: Impact })),
  eventType: EventType,
  themes: z.array(Theme),
  importance: Importance,
  provider: LlmProvider,
  model: z.string().min(1),
  extractedAt: z.date(),
});
export type Extraction = z.infer<typeof Extraction>;

export const MarketEvent = z.strictObject({
  _id: Id,
  // The cluster of Source ids behind this event.
  sourceIds: z.array(Id).min(1),
  headline: NonBlank,
  publishedAt: z.date(),
  status: EventStatus,
  extraction: Extraction.nullable(),
  embedding: Embedding.nullable(),
  createdAt: z.date(),
});
export type MarketEvent = z.infer<typeof MarketEvent>;

export const PathHop = z.strictObject({
  from: UniverseSymbol,
  to: UniverseSymbol,
  type: RelationshipType,
  weight: z.number().gt(0).max(1),
  relationshipId: Id,
});
export type PathHop = z.infer<typeof PathHop>;

// The exact graph path behind a relevance score. "Why you" is rendered from it with templates
// and never stored. A direct holding has no hops.
export const FeedPath = z
  .strictObject({
    eventCompany: UniverseSymbol,
    holding: UniverseSymbol,
    hops: z.array(PathHop).max(2),
  })
  .refine(
    (path) => {
      let at: UniverseSymbol = path.eventCompany;
      for (const hop of path.hops) {
        if (hop.from !== at) return false;
        at = hop.to;
      }
      return at === path.holding;
    },
    { error: 'hops must lead from the event company to the holding' },
  );
export type FeedPath = z.infer<typeof FeedPath>;

export const ResearchState = z.enum(['none', 'queued', 'running', 'done', 'failed']);
export type ResearchState = z.infer<typeof ResearchState>;

// One per user and event.
export const FeedItem = z
  .strictObject({
    _id: Id,
    userId: Id,
    eventId: Id,
    relevance: Relevance,
    path: FeedPath.nullable(),
    confidence: Confidence,
    status: EventStatus,
    research: z.strictObject({ state: ResearchState, runId: Id.nullable() }),
    createdAt: z.date(),
    updatedAt: z.date(),
  })
  .refine((item) => (item.path === null) === (item.relevance === 0), {
    error: 'an item has a path exactly when its relevance is above 0',
    path: ['path'],
  });
export type FeedItem = z.infer<typeof FeedItem>;
