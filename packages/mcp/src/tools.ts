import {
  EventStatus,
  Extraction,
  Id,
  Ticker,
  Tier,
  type MarketEvent,
  type Source,
} from '@kesher/shared';
import type { Collection, Filter } from 'mongodb';
import { z } from 'zod';
import type { RunTokenClaims, ToolName } from './token';

// Read only access; the api passes its collections in.
export interface ToolDeps {
  events: Collection<MarketEvent>;
  sources: Collection<Source>;
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

const SearchNewsOutput = z.strictObject({ items: z.array(NewsHit).max(MAX_NEWS_RESULTS) });
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

    const output: SearchNewsOutput = {
      items: ranked.map(({ doc, matchedTerms }) => ({
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
      })),
    };
    return { ok: true, output };
  },
};

// Every tool the server implements. The run token decides which of them a caller sees.
export const TOOLS = [getEvent, searchNews] as const;
