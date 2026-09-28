import type { Benchmark, FilingForm, Source, Tier, UniverseSymbol, User } from '@kesher/shared';

// View types for the feed screen. They cover what packages/shared has no schema for yet; the
// domain types themselves (FeedItem, MarketEvent, Company, Relationship) come from there.

export type PersonaKey = 'A' | 'B' | 'C';

// The public part of a seeded user, plus the labels the switcher shows. T06 wiring replaces
// this with the public user shape the api returns; passwordHash and email never reach the web.
export interface Persona extends Pick<User, '_id' | 'displayName' | 'holdings'> {
  key: PersonaKey;
  switcherLabel: string;
  youLabel: string;
}

// The news source behind an event, as the event detail shows it.
export interface NewsSourceView extends Pick<
  Source,
  '_id' | 'provider' | 'tier' | 'externalId' | 'publishedAt'
> {
  wire: string;
}

// A filing cited as edge evidence, keyed by Evidence.sourceId.
export interface FilingView {
  sourceId: string;
  company: UniverseSymbol;
  form: FilingForm;
  tier: Tier;
}

// The price reaction from SPEC.md, Price reaction. Moves are percentages, in the order of
// the windows. T13 computes these; until then they come from the fixtures.
export interface PriceReaction {
  anchor: {
    kind: 'headline' | 'previous_close';
    baseAt: Date;
    tradingDay: Date;
  };
  windows: string[];
  rows: { symbol: UniverseSymbol | Benchmark; moves: number[] }[];
  delayNote: string;
}
