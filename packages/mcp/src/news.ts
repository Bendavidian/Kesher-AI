import { Id, Ticker, Tier } from '@kesher/shared';
import { z } from 'zod';
import { fitItems } from './fit';
import type { NewsFilter } from './search';
import type { ToolDefinition } from './tools';

// search_news: hybrid search over news Sources (SPEC.md decision log, T13). Two ranked lists,
// fused by code with reciprocal rank fusion:
// - text: the Atlas Search index on sources (title and body), filtered by kind, symbols and since;
// - vector: the nearest MarketEvents by embedding, each standing for its news sources.
// Only ranks enter the fusion. No score is read, compared or used as a threshold (principle 3).

export const MAX_QUERY_TERMS = 8;
export const MAX_NEWS_RESULTS = 10;
export const EXCERPT_CHARS = 500;
// How many results each list contributes before fusion.
export const LEG_LIMIT = 50;
// The usual reciprocal rank fusion constant: a result's weight is 1 / (RRF_K + rank).
export const RRF_K = 60;

const IsoTime = z.iso.datetime({ offset: true });

const SearchNewsInput = z.strictObject({
  query: z.string().trim().min(1).max(200).describe('What to look for, in words or in meaning'),
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
  // Distinct query words found in the title or body. 0 for an item found by meaning alone.
  matchedTerms: z.int().min(0),
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

export function matchedTerms(title: string, text: string | null, terms: string[]): number {
  const haystack = `${title}\n${text ?? ''}`.toLowerCase();
  return terms.filter((term) => haystack.includes(term)).length;
}

interface Fusable {
  _id: string;
  publishedAt: Date;
}

// Reciprocal rank fusion. ranks are 0 based positions in each list; a candidate in neither list
// is left out. Ties go to the newest item, then the id, so equal inputs give equal order.
export function fuseRanks<C extends Fusable>(
  candidates: readonly C[],
  lists: readonly ReadonlyMap<string, number>[],
  limit = MAX_NEWS_RESULTS,
): C[] {
  return candidates
    .map((candidate) => ({
      candidate,
      fused: lists.reduce((sum, ranks) => {
        const rank = ranks.get(candidate._id);
        return rank === undefined ? sum : sum + 1 / (RRF_K + rank + 1);
      }, 0),
    }))
    .filter(({ fused }) => fused > 0)
    .sort(
      (a, b) =>
        b.fused - a.fused ||
        b.candidate.publishedAt.getTime() - a.candidate.publishedAt.getTime() ||
        a.candidate._id.localeCompare(b.candidate._id),
    )
    .slice(0, limit)
    .map(({ candidate }) => candidate);
}

const positions = (ids: readonly string[]) => {
  const ranks = new Map<string, number>();
  ids.forEach((id, i) => {
    if (!ranks.has(id)) ranks.set(id, i);
  });
  return ranks;
};

export const searchNews: ToolDefinition<typeof SearchNewsInput, typeof SearchNewsOutput> = {
  name: 'search_news',
  description:
    'News items related to the query by words or by meaning, optionally filtered by tickers and a start time, best first. At most 10 items. matchedTerms 0 means an item was found by meaning alone and may be only loosely related.',
  inputSchema: SearchNewsInput,
  outputSchema: SearchNewsOutput,
  async run({ query, symbols, since }, { sources, events, search }) {
    const filter: NewsFilter = {
      ...(symbols ? { symbols } : {}),
      ...(since ? { since: new Date(since) } : {}),
    };
    // Each list may fail on its own, for example the text index while it builds; the other still
    // answers. The api logs the cause where it passes the search in.
    const [text, vector] = await Promise.allSettled([
      search.newsText(query, filter, LEG_LIMIT),
      search.embedQuery(query).then((v) => search.eventVectors(v, LEG_LIMIT)),
    ]);
    if (text.status === 'rejected' && vector.status === 'rejected') {
      return { ok: false, error: 'News search is unavailable' };
    }
    const textRanks = positions(text.status === 'fulfilled' ? text.value : []);
    const eventIds = vector.status === 'fulfilled' ? vector.value : [];

    // An event ranks each of its sources at the event's own place.
    const eventRank = positions(eventIds);
    const vectorRanks = new Map<string, number>();
    const nearest = await events
      .find({ _id: { $in: eventIds } }, { projection: { _id: 1, sourceIds: 1 } })
      .toArray();
    for (const event of nearest) {
      const rank = eventRank.get(event._id)!;
      for (const id of event.sourceIds) {
        if (rank < (vectorRanks.get(id) ?? Infinity)) vectorRanks.set(id, rank);
      }
    }

    // The same filters on both lists, applied here too, since the event index has no filters.
    const candidates = await sources
      .find({
        _id: { $in: [...new Set([...textRanks.keys(), ...vectorRanks.keys()])] },
        kind: 'news',
        ...(symbols ? { symbols: { $in: symbols } } : {}),
        ...(since ? { publishedAt: { $gte: new Date(since) } } : {}),
      })
      .toArray();
    const ranked = fuseRanks(candidates, [textRanks, vectorRanks]);

    const clusters = await events
      .find(
        { sourceIds: { $in: ranked.map((doc) => doc._id) } },
        { projection: { _id: 1, sourceIds: 1 } },
      )
      .toArray();
    const eventOf = new Map(
      clusters.flatMap((event) => event.sourceIds.map((id) => [id, event._id])),
    );
    const terms = queryTerms(query);
    const hits = ranked.map((doc) => ({
      sourceId: doc._id,
      eventId: eventOf.get(doc._id) ?? null,
      title: doc.title,
      url: doc.url,
      publishedAt: doc.publishedAt.toISOString(),
      symbols: doc.symbols,
      tier: doc.tier,
      excerpt: doc.text === null ? null : doc.text.slice(0, EXCERPT_CHARS),
      injectionFlagged: doc.injectionScreen?.flagged ?? null,
      matchedTerms: matchedTerms(doc.title, doc.text, terms),
    }));
    const output: SearchNewsOutput = fitItems(hits, (items, omitted) => ({ items, omitted }));
    return { ok: true, output };
  },
};
