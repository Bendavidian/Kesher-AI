import {
  EventStatus,
  Extraction,
  Id,
  PriceAnchor,
  PriceReactionError,
  PriceSymbol,
  PriceWindowName,
  priceReactionExternalId,
  TradingDay,
  UniverseSymbol,
  type Company,
  type MarketEvent,
  PriceReaction,
  type Relationship,
  type Source,
  type User,
} from '@kesher/shared';
import type { Collection } from 'mongodb';
import { z } from 'zod';
import type { SearchBackend } from './search';
import { sourceIdFor } from './sourceIds';
import type { RunTokenClaims, ToolName } from './token';

// Read only access; the api passes its collections and its market data in.
export interface ToolDeps {
  users: Collection<User>;
  events: Collection<MarketEvent>;
  sources: Collection<Source>;
  relationships: Collection<Relationship>;
  companies: Collection<Company>;
  search: SearchBackend;
  // priceReactionFor in packages/shared over the api's market data: the subjects, then SMH and SPY.
  priceReaction: (subjects: readonly PriceSymbol[], headline: Date) => Promise<PriceReaction>;
}

// The verified run token. Tools that need a user read it from here, never from arguments.
export interface ToolContext {
  claims: RunTokenClaims;
}

export type ToolOutcome<O> = { ok: true; output: O } | { ok: false; error: string };

export interface ToolDefinition<I extends z.ZodType, O extends z.ZodType> {
  name: ToolName;
  description: string;
  // Strict objects: an argument the contract does not name, such as a user id, is rejected.
  inputSchema: I;
  outputSchema: O;
  run(input: z.output<I>, deps: ToolDeps, ctx: ToolContext): Promise<ToolOutcome<z.output<O>>>;
}

const IsoTime = z.iso.datetime({ offset: true });

// get_event ------------------------------------------------------------------------------------

const GetEventInput = z.strictObject({
  eventId: Id.describe('The MarketEvent id'),
});

const GetEventOutput = z.strictObject({
  eventId: Id,
  headline: z.string(),
  publishedAt: IsoTime,
  status: EventStatus,
  // null until extraction has run.
  extraction: Extraction.extend({ extractedAt: IsoTime }).nullable(),
  sourceIds: z.array(Id),
});
type GetEventOutput = z.output<typeof GetEventOutput>;

export const getEvent: ToolDefinition<typeof GetEventInput, typeof GetEventOutput> = {
  name: 'get_event',
  description: 'One market event with its extraction and source ids.',
  inputSchema: GetEventInput,
  outputSchema: GetEventOutput,
  async run({ eventId }, { events }) {
    // The embedding never leaves the database.
    const event = await events.findOne({ _id: eventId }, { projection: { embedding: 0 } });
    if (!event) return { ok: false, error: `No event with id ${eventId}` };
    const output: GetEventOutput = {
      eventId: event._id,
      headline: event.headline,
      publishedAt: event.publishedAt.toISOString(),
      status: event.status,
      extraction: event.extraction && {
        ...event.extraction,
        extractedAt: event.extraction.extractedAt.toISOString(),
      },
      sourceIds: event.sourceIds,
    };
    return { ok: true, output };
  },
};

// get_price_reaction ---------------------------------------------------------------------------
// Temporal association only: the moves show what traded at the same time, never why.

const GetPriceReactionInput = z.strictObject({
  symbol: UniverseSymbol.describe('A demo universe company'),
  eventTime: IsoTime.describe('The headline time; not in the future'),
});

export const GetPriceReactionOutput = z.strictObject({
  // The market_data Source that cites these moves; a metric claim about them names it.
  sourceId: Id,
  anchor: PriceAnchor.extend({ baseTime: IsoTime, tradingDay: TradingDay }),
  windows: z.array(z.strictObject({ name: PriceWindowName, endsAt: IsoTime })),
  rows: z.array(
    z.strictObject({
      symbol: PriceSymbol,
      basePrice: z.number().nullable(),
      baseBarTime: IsoTime.nullable(),
      moves: z.array(z.strictObject({ pct: z.number().nullable(), barTime: IsoTime.nullable() })),
    }),
  ),
  delayed: z.literal(true),
  complete: z.boolean(),
});
export type GetPriceReactionOutput = z.output<typeof GetPriceReactionOutput>;
type ReactionJson = Omit<GetPriceReactionOutput, 'sourceId'>;

const iso = (date: Date | null) => date?.toISOString() ?? null;

export function priceReactionJson(reaction: PriceReaction): ReactionJson {
  return {
    anchor: { ...reaction.anchor, baseTime: reaction.anchor.baseTime.toISOString() },
    windows: reaction.windows.map((w) => ({ name: w.name, endsAt: w.endsAt.toISOString() })),
    rows: reaction.rows.map((row) => ({
      symbol: row.symbol,
      basePrice: row.basePrice,
      baseBarTime: iso(row.baseBarTime),
      moves: row.moves.map((move) => ({ pct: move.pct, barTime: iso(move.barTime) })),
    })),
    delayed: reaction.delayed,
    complete: reaction.complete,
  };
}

const date = (iso: string | null) => (iso === null ? null : new Date(iso));

// The inverse of priceReactionJson, for code that stores what a call returned.
export function priceReactionFromJson(json: ReactionJson | GetPriceReactionOutput): PriceReaction {
  return PriceReaction.parse({
    anchor: { ...json.anchor, baseTime: new Date(json.anchor.baseTime) },
    windows: json.windows.map((w) => ({ name: w.name, endsAt: new Date(w.endsAt) })),
    rows: json.rows.map((row) => ({
      symbol: row.symbol,
      basePrice: row.basePrice,
      baseBarTime: date(row.baseBarTime),
      moves: row.moves.map((move) => ({ pct: move.pct, barTime: date(move.barTime) })),
    })),
    delayed: json.delayed,
    complete: json.complete,
  });
}

export const getPriceReaction: ToolDefinition<
  typeof GetPriceReactionInput,
  typeof GetPriceReactionOutput
> = {
  name: 'get_price_reaction',
  description:
    'Percent moves of a company, SMH and SPY after a headline, anchored to the regular session: from the price at the headline, or from the previous close with an open gap. SIP data delayed 15 minutes. Shows timing only, never a cause.',
  inputSchema: GetPriceReactionInput,
  outputSchema: GetPriceReactionOutput,
  async run({ symbol, eventTime }, { priceReaction, sources }) {
    let reaction: PriceReaction;
    try {
      reaction = await priceReaction([symbol], new Date(eventTime));
    } catch (error) {
      // Only the reaction's own reasons reach the agent. A provider error stays on the server,
      // which logs it where it passes priceReaction in.
      if (error instanceof PriceReactionError) return { ok: false, error: error.message };
      return { ok: false, error: 'Market data is unavailable' };
    }
    const sourceId = await sourceIdFor(sources, 'alpaca', priceReactionExternalId(reaction));
    return { ok: true, output: { sourceId, ...priceReactionJson(reaction) } };
  },
};
