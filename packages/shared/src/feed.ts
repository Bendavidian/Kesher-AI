import { z } from 'zod';
import { Confidence, Id, NonBlank, Relevance, Tier } from './domain/common';
import { FeedItem, FeedPath, MarketEvent } from './domain/event';
import { FilingForm } from './domain/filing';
import { RelationshipType } from './domain/graph';
import { Source } from './domain/source';
import { UniverseSymbol } from './domain/universe';
import { PriceReaction } from './price';

// Display bands for the code computed relevance, named like the SPEC.md eval labels (SPEC.md
// decision log, T16): high only for a direct holding, medium for any other relevance above 0, none
// at 0. Structural only: a supply hop at 0.8 is medium. Bands only label a score; the gate and the
// feed read the score itself, so they decide nothing.
export const RELEVANCE_HIGH = 1;

export type RelevanceBand = 'high' | 'medium' | 'none';

export function relevanceBand(relevance: Relevance): RelevanceBand {
  if (relevance <= 0) return 'none';
  return relevance >= RELEVANCE_HIGH ? 'high' : 'medium';
}

// The filing behind one hop's edge. The form is the filer's annual form, the one every seeded
// edge quotes; T11 can take it from FilingChunk instead.
export const FeedFiling = z.strictObject({
  sourceId: Id,
  symbol: UniverseSymbol,
  title: NonBlank,
  form: FilingForm,
  tier: Tier,
});
export type FeedFiling = z.infer<typeof FeedFiling>;

// The evidence for one hop of the path. Only reviewed edges are evidence (no evidence, no edge).
export const FeedEvidence = z.strictObject({
  relationshipId: Id,
  from: UniverseSymbol,
  to: UniverseSymbol,
  type: RelationshipType,
  quote: NonBlank,
  filingDate: z.iso.date(),
  url: z.httpUrl(),
  reviewed: z.literal(true),
  filing: FeedFiling,
});
export type FeedEvidence = z.infer<typeof FeedEvidence>;

// The event on a card, without its embedding.
export const FeedCardEvent = MarketEvent.omit({ embedding: true });
export type FeedCardEvent = z.infer<typeof FeedCardEvent>;

// The source on a card. The body text stays on the server: it is untrusted data.
export const FeedCardSource = Source.pick({
  _id: true,
  provider: true,
  kind: true,
  tier: true,
  externalId: true,
  url: true,
  publisher: true,
  title: true,
  publishedAt: true,
  injectionScreen: true,
});
export type FeedCardSource = z.infer<typeof FeedCardSource>;

// The FeedCard read model (docs/INTERFACES.md), assembled on the server from stored documents.
// Nothing here is written by a model: the path, relevance and confidence are code, and "Why you"
// is rendered from the path with the whyYou templates. priceReaction is computed by code from
// market data (priceReactionFor), for the path's event company and holding next to SMH and SPY;
// null when the market data could not be read.
export const FeedCard = z.strictObject({
  item: FeedItem,
  event: FeedCardEvent,
  source: FeedCardSource,
  // One entry per hop that has reviewed evidence, in path order.
  evidence: z.array(FeedEvidence).max(2),
  priceReaction: PriceReaction.nullable(),
});
export type FeedCard = z.infer<typeof FeedCard>;

// GET /events/:eventId/explain (docs/INTERFACES.md): why an event is or is not in the signed in
// user's feed, computed on request by the same code as relevance and never stored. It is how the
// web shows None for an event that no FeedCard list carries. No FeedItem, so no research state.
export const EventExplain = z
  .strictObject({
    event: FeedCardEvent,
    source: FeedCardSource,
    relevance: Relevance,
    path: FeedPath.nullable(),
    confidence: Confidence,
    evidence: z.array(FeedEvidence).max(2),
  })
  .refine((explain) => (explain.path === null) === (explain.relevance === 0), {
    error: 'an explanation has a path exactly when its relevance is above 0',
    path: ['path'],
  });
export type EventExplain = z.infer<typeof EventExplain>;
