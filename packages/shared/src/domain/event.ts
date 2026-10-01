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
// and never stored. A direct holding has no hops. named: the extraction names the event company;
// false when only the provider tagged it, a passing mention that scores half (SPEC.md decision
// log, T27). A path stored before T27 has no flag and reads as named, since T05 started the graph
// only from named companies.
export const FeedPath = z
  .strictObject({
    eventCompany: UniverseSymbol,
    named: z.boolean().default(true),
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

// Whether the path starts from a company the item only mentions (T27). Only an explicit false is a
// mention: a path stored before T27 and read without the schema has no flag, and T05 started the
// graph only from companies the extraction named.
export const onlyMentioned = (path: FeedPath): boolean => path.named === false;

export const ResearchState = z.enum(['none', 'queued', 'running', 'done', 'failed']);
export type ResearchState = z.infer<typeof ResearchState>;

// The research attached to a card, written by code only (apps/api/src/research/investigate.ts).
// Investigate names the run from the start; a failure before the run was stored names none. A
// done run always has its report.
export const FeedResearch = z
  .strictObject({ state: ResearchState, runId: Id.nullable(), reportId: Id.nullable() })
  .refine((research) => (research.reportId !== null) === (research.state === 'done'), {
    error: 'research has a report exactly when it is done',
    path: ['reportId'],
  })
  .refine((research) => research.state !== 'done' || research.runId !== null, {
    error: 'done research names its run',
    path: ['runId'],
  });
export type FeedResearch = z.infer<typeof FeedResearch>;

export const NO_RESEARCH: FeedResearch = { state: 'none', runId: null, reportId: null };

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
    research: FeedResearch,
    createdAt: z.date(),
    updatedAt: z.date(),
    // A guest's items expire with the guest (SPEC.md decision log, T24).
    expiresAt: z.date().optional(),
  })
  .refine((item) => (item.path === null) === (item.relevance === 0), {
    error: 'an item has a path exactly when its relevance is above 0',
    path: ['path'],
  });
export type FeedItem = z.infer<typeof FeedItem>;
