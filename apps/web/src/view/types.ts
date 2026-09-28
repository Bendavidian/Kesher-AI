import type {
  AgentRun,
  Benchmark,
  FilingForm,
  Source,
  Tier,
  UniverseSymbol,
  User,
} from '@kesher/shared';

// View types for the web screens. They cover what packages/shared has no schema for yet; the
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

// The agent a run token is minted for. packages/shared exports no AgentName, so it is read off
// AgentRun.agent; T07 owns the run token and can move the name into shared.
export type AgentName = AgentRun['agent'];

// What a run token allows (SPEC.md, MCP tool layer). T07 mints and verifies the real token;
// the web only shows its scope. The user is not part of it here: that comes from sign in.
export interface RunTokenScope {
  agent: AgentName;
  tools: string[];
  // Collections the agent may write. Every research tool is read only, so this stays empty.
  writes: string[];
  ttlMinutes: number;
}

// A step's full output, for the detail panel. AgentStep stores only outputSummary, so this
// comes from the fixtures until T09 decides where step output lives.
export interface StepOutput {
  value: unknown;
  // A note for the output heading, such as a cap on its size.
  note: string | null;
}

// A source the report cites, as the side panel lists it.
export interface ReportSourceView extends Pick<Source, '_id' | 'kind' | 'tier'> {
  // Benzinga via Alpaca
  title: string;
  // How a claim's evidence line names it: Benzinga headline
  citeLabel: string;
  // The provider id, the accession number, or the delay note for market data.
  ref: string;
}
