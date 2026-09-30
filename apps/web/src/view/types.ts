import type {
  AgentName,
  Benchmark,
  FilingForm,
  PersonaKey,
  PublicUser,
  ReportSource,
  Source,
  Tier,
  ToolName,
  UniverseSymbol,
} from '@kesher/shared';

// View types for the web screens. They cover what packages/shared has no schema for yet; the
// domain types themselves (FeedItem, MarketEvent, Company, Relationship) come from there.

export type { PersonaKey };

// Whose feed the screen shows: a seeded persona, or the visitor's guest portfolio (T24).
export type ViewerKey = PersonaKey | 'guest';

// The chosen viewer. session counts guest sign ins and portfolio changes, so each one loads the
// feed again; a persona keeps 0.
export interface Viewer {
  key: ViewerKey;
  session: number;
}

// The signed in user from the api (PublicUser), plus the labels the switcher shows.
export interface Persona extends Pick<PublicUser, '_id' | 'displayName' | 'holdings'> {
  key: ViewerKey;
  switcherLabel: string;
  youLabel: string;
}

// The news source behind an event, as the event detail shows it.
export interface NewsSourceView extends Pick<
  Source,
  '_id' | 'provider' | 'tier' | 'externalId' | 'publishedAt'
> {
  // The publisher behind the provider, such as Benzinga; null when the provider names none.
  wire: string | null;
}

// A filing cited as edge evidence, keyed by Evidence.sourceId.
export interface FilingView {
  sourceId: string;
  company: UniverseSymbol;
  form: FilingForm;
  tier: Tier;
}

// The price reaction from SPEC.md, Price reaction, as the screens show it (priceReactionView maps
// the api's). Moves are percentages in the order of the windows; null while a window is not ready.
export interface PriceReaction {
  anchor: {
    kind: 'headline' | 'previous_close';
    baseAt: Date;
    tradingDay: Date;
  };
  windows: string[];
  rows: { symbol: UniverseSymbol | Benchmark; moves: (number | null)[] }[];
  delayNote: string;
}

// What a run token allowed, as its Run token issued step records it (docs/INTERFACES.md). The
// user is not part of it here: that comes from sign in.
export interface RunTokenScope {
  agent: AgentName;
  tools: ToolName[];
  ttlMinutes: number;
}

// A source the report cites, as the side panel lists it: the api's read model.
export type ReportSourceView = ReportSource;
