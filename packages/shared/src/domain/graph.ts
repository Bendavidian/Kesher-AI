import { z } from 'zod';
import { Id, NonBlank, Theme, Ticker } from './common';
import { UniverseSymbol } from './universe';

// Interest graph, SPEC.md. Nodes are the demo universe companies; holds is derived from
// User.holdings and never stored as an edge.

export const Company = z.strictObject({
  _id: Id,
  // The US ticker used for news and prices.
  symbol: UniverseSymbol,
  // The home listing from the Finnhub profile, for example 2330.TW for TSM.
  primaryListing: Ticker,
  name: z.string().min(1),
  cik: z.string().regex(/^\d{10}$/),
  // Foreign issuers such as TSM and ASML file 20-F instead of 10-K.
  filerType: z.enum(['10-K', '20-F']),
  sector: z.string().regex(/^[a-z][a-z0-9_]*$/),
  themes: z.array(Theme),
  createdAt: z.date(),
});
export type Company = z.infer<typeof Company>;

// T02 stores only edges that carry filing evidence. Sector and theme edges are decided in T11.
export const RELATIONSHIP_TYPES = ['supplier_of', 'customer_of', 'competitor_of'] as const;
export const RelationshipType = z.enum(RELATIONSHIP_TYPES);
export type RelationshipType = z.infer<typeof RelationshipType>;

// Every relationship is stored in both directions with its inverse type.
export const INVERSE_TYPE = {
  supplier_of: 'customer_of',
  customer_of: 'supplier_of',
  competitor_of: 'competitor_of',
} as const satisfies Record<RelationshipType, RelationshipType>;

// Starting weights from SPEC.md Scores, written onto each edge. Scoring itself is T05.
export const EDGE_WEIGHTS = {
  supplier_of: 0.8,
  customer_of: 0.8,
  competitor_of: 0.6,
} as const satisfies Record<RelationshipType, number>;

// No evidence, no edge. The quote is verbatim from the source; unreviewed edges are never used.
export const Evidence = z.strictObject({
  sourceId: Id,
  quote: NonBlank,
  filingDate: z.iso.date(),
  url: z.httpUrl(),
  reviewed: z.boolean(),
});
export type Evidence = z.infer<typeof Evidence>;

export const Relationship = z
  .strictObject({
    _id: Id,
    from: UniverseSymbol,
    to: UniverseSymbol,
    type: RelationshipType,
    weight: z.number().gt(0).max(1),
    evidence: Evidence,
    createdAt: z.date(),
  })
  .refine((edge) => edge.from !== edge.to, { error: 'from and to must differ', path: ['to'] });
export type Relationship = z.infer<typeof Relationship>;

interface EdgeEnds {
  from: UniverseSymbol;
  to: UniverseSymbol;
  type: RelationshipType;
}

// Returns the edge and its inverse: ends swapped, type inverted, everything else shared.
export function withInverse<T extends EdgeEnds>(edge: T): [T, T] {
  return [edge, { ...edge, from: edge.to, to: edge.from, type: INVERSE_TYPE[edge.type] }];
}
