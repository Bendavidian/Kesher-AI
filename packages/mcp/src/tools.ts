import {
  EventStatus,
  Extraction,
  Id,
  PriceAnchor,
  PriceReactionError,
  PriceSymbol,
  PriceWindowName,
  Ticker,
  Tier,
  TradingDay,
  UniverseSymbol,
  type Company,
  type MarketEvent,
  type PriceReaction,
  type Relationship,
  type Source,
  type User,
} from '@kesher/shared';
import type { Collection, Filter } from 'mongodb';
import { z } from 'zod';
import { fitItems } from './fit';
import type { SearchBackend } from './search';
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

// search_news ----------------------------------------------------------------------------------
// Thin: keyword match with deterministic ranking. T13 replaces it with hybrid search.

export const MAX_QUERY_TERMS = 8;
export const MAX_CANDIDATES = 200;
export const MAX_NEWS_RESULTS = 10;
export const EXCERPT_CHARS = 500;

const SearchNewsInput = z.strictObject({
  query: z.string().trim().min(1).max(200).describe('Words to match in the title or body'),
  symbols: z
    .array(Ticker)
    .min(1)
    .max(20)
    .optional()
    .describe('Only items tagged with at least one of these tickers'),
  since: IsoTime.optional().describe('Only items published at or after this time'),
});

const NewsHit = z.strictObject({
  sourceId: Id,
  // The event this source belongs to, when one exists.
  eventId: Id.nullable(),
  title: z.string(),
  url: z.string(),
  publishedAt: IsoTime,
  symbols: z.array(Ticker),
  tier: Tier,
  // Untrusted article text: data for the agent, never instructions (principle 6).
  excerpt: z.string().nullable(),
  // The injection screen label; null when the item has not been screened.
  injectionFlagged: z.boolean().nullable(),
  matchedTerms: z.int().min(1),
});

const SearchNewsOutput = z.strictObject({
  items: z.array(NewsHit).max(MAX_NEWS_RESULTS),
  // Ranked items left out to keep the output within 8 KB.
  omitted: z.int().min(0),
});
type SearchNewsOutput = z.output<typeof SearchNewsOutput>;

export function queryTerms(query: string): string[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return [...new Set(words)].slice(0, MAX_QUERY_TERMS);
}

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

interface Rankable {
  _id: string;
  title: string;
  text: string | null;
  publishedAt: Date;
}

// Distinct terms matched, then newest first, then id, so equal inputs give equal order.
export function rankNews<D extends Rankable>(
  docs: D[],
  terms: string[],
  limit = MAX_NEWS_RESULTS,
): { doc: D; matchedTerms: number }[] {
  return docs
    .map((doc) => {
      const haystack = `${doc.title}\n${doc.text ?? ''}`.toLowerCase();
      return { doc, matchedTerms: terms.filter((term) => haystack.includes(term)).length };
    })
    .filter((hit) => hit.matchedTerms > 0)
    .sort(
      (a, b) =>
        b.matchedTerms - a.matchedTerms ||
        b.doc.publishedAt.getTime() - a.doc.publishedAt.getTime() ||
        a.doc._id.localeCompare(b.doc._id),
    )
    .slice(0, limit);
}

export const searchNews: ToolDefinition<typeof SearchNewsInput, typeof SearchNewsOutput> = {
  name: 'search_news',
  description:
    'News items matching the query words, optionally filtered by tickers and a start time, ranked by words matched and then recency. At most 10 items.',
  inputSchema: SearchNewsInput,
  outputSchema: SearchNewsOutput,
  async run({ query, symbols, since }, { sources, events }) {
    const terms = queryTerms(query);
    const patterns = terms.map((term) => new RegExp(escapeRegex(term), 'i'));
    const filter: Filter<Source> = {
      kind: 'news',
      $or: patterns.flatMap((pattern) => [{ title: pattern }, { text: pattern }]),
    };
    if (symbols) filter.symbols = { $in: symbols };
    if (since) filter.publishedAt = { $gte: new Date(since) };

    const candidates = await sources
      .find(filter)
      .sort({ publishedAt: -1, _id: 1 })
      .limit(MAX_CANDIDATES)
      .toArray();
    const ranked = rankNews(candidates, terms);

    const clusters = await events
      .find(
        { sourceIds: { $in: ranked.map((hit) => hit.doc._id) } },
        { projection: { _id: 1, sourceIds: 1 } },
      )
      .toArray();
    const eventOf = new Map(
      clusters.flatMap((event) => event.sourceIds.map((id) => [id, event._id])),
    );

    const hits = ranked.map(({ doc, matchedTerms }) => ({
      sourceId: doc._id,
      eventId: eventOf.get(doc._id) ?? null,
      title: doc.title,
      url: doc.url,
      publishedAt: doc.publishedAt.toISOString(),
      symbols: doc.symbols,
      tier: doc.tier,
      excerpt: doc.text === null ? null : doc.text.slice(0, EXCERPT_CHARS),
      injectionFlagged: doc.injectionScreen?.flagged ?? null,
      matchedTerms,
    }));
    const output: SearchNewsOutput = fitItems(hits, (items, omitted) => ({ items, omitted }));
    return { ok: true, output };
  },
};

// get_price_reaction ---------------------------------------------------------------------------
// Temporal association only: the moves show what traded at the same time, never why.

const GetPriceReactionInput = z.strictObject({
  symbol: UniverseSymbol.describe('A demo universe company'),
  eventTime: IsoTime.describe('The headline time; not in the future'),
});

const GetPriceReactionOutput = z.strictObject({
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
type GetPriceReactionOutput = z.output<typeof GetPriceReactionOutput>;

const iso = (date: Date | null) => date?.toISOString() ?? null;

export function priceReactionJson(reaction: PriceReaction): GetPriceReactionOutput {
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

export const getPriceReaction: ToolDefinition<
  typeof GetPriceReactionInput,
  typeof GetPriceReactionOutput
> = {
  name: 'get_price_reaction',
  description:
    'Percent moves of a company, SMH and SPY after a headline, anchored to the regular session: from the price at the headline, or from the previous close with an open gap. SIP data delayed 15 minutes. Shows timing only, never a cause.',
  inputSchema: GetPriceReactionInput,
  outputSchema: GetPriceReactionOutput,
  async run({ symbol, eventTime }, { priceReaction }) {
    try {
      return {
        ok: true,
        output: priceReactionJson(await priceReaction([symbol], new Date(eventTime))),
      };
    } catch (error) {
      // Only the reaction's own reasons reach the agent. A provider error stays on the server,
      // which logs it where it passes priceReaction in.
      if (error instanceof PriceReactionError) return { ok: false, error: error.message };
      return { ok: false, error: 'Market data is unavailable' };
    }
  },
};
