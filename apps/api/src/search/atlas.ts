import type { FilingPassage, NewsFilter, SearchBackend } from '@kesher/mcp';
import type { UniverseSymbol } from '@kesher/shared';
import type { Db, Document } from 'mongodb';
import { collection } from '../db/collections';
import type { LazyEmbedder } from '../embed/event';

// The searches behind the MCP tools, on the Atlas search indexes that npm run seed creates
// (SEARCH_INDEXES in db/indexes.ts). Plain mongod has no $vectorSearch or $search, so tests pass
// an in memory backend instead (test/search.ts). Scores only order results (principle 3).

// Candidates per result for approximate nearest neighbour search, as in T11's check: 150 for
// the 3 passages of search_filings.
const CANDIDATES_PER_RESULT = 50;

export function filingPassagesPipeline(
  symbol: UniverseSymbol,
  vector: readonly number[],
  limit: number,
): Document[] {
  return [
    {
      $vectorSearch: {
        index: 'filing_chunks_vector',
        path: 'embedding',
        queryVector: [...vector],
        numCandidates: limit * CANDIDATES_PER_RESULT,
        limit,
        filter: { symbol },
      },
    },
    { $project: { _id: 0, sourceId: 1, symbol: 1, form: 1, section: 1, chunkIndex: 1, text: 1 } },
  ];
}

// The text list of search_news: the query words in the title or body of news Sources, on the
// sources_text index, with the filters inside the search so the limit counts matches only.
export function newsTextPipeline(query: string, filter: NewsFilter, limit: number): Document[] {
  return [
    {
      $search: {
        index: 'sources_text',
        compound: {
          must: [{ text: { query, path: ['title', 'text'] } }],
          filter: [
            { equals: { path: 'kind', value: 'news' } },
            ...(filter.symbols ? [{ in: { path: 'symbols', value: [...filter.symbols] } }] : []),
            ...(filter.since ? [{ range: { path: 'publishedAt', gte: filter.since } }] : []),
          ],
        },
      },
    },
    { $limit: limit },
    { $project: { _id: 1 } },
  ];
}

// The vector list of search_news: the events nearest to the query. The index has no filter
// fields, so search_news applies symbols and since to their sources.
export function eventVectorsPipeline(vector: readonly number[], limit: number): Document[] {
  return [
    {
      $vectorSearch: {
        index: 'market_events_vector',
        path: 'embedding',
        queryVector: [...vector],
        numCandidates: limit * 10,
        limit,
      },
    },
    { $project: { _id: 1 } },
  ];
}

const ids = (docs: { _id: string }[]) => docs.map((doc) => doc._id);

export function atlasSearch(db: Db, embedder?: LazyEmbedder): SearchBackend {
  return {
    async embedQuery(text) {
      if (!embedder) throw new Error('the embedding model is not configured');
      const [vector] = await (await embedder()).embed([text]);
      if (!vector) throw new Error('the embedder returned no vector');
      return vector;
    },
    filingPassages: (symbol, vector, limit) =>
      collection(db, 'filing_chunks')
        .aggregate<FilingPassage>(filingPassagesPipeline(symbol, vector, limit))
        .toArray(),
    newsText: async (query, filter, limit) =>
      ids(
        await collection(db, 'sources')
          .aggregate<{ _id: string }>(newsTextPipeline(query, filter, limit))
          .toArray(),
      ),
    eventVectors: async (vector, limit) =>
      ids(
        await collection(db, 'market_events')
          .aggregate<{ _id: string }>(eventVectorsPipeline(vector, limit))
          .toArray(),
      ),
  };
}

// Logs a failed search where it happens and rethrows it; the tool answers a generic message.
export function loggedSearch(
  search: SearchBackend,
  onError?: (error: Error) => void,
): SearchBackend {
  const log = (error: unknown) => {
    onError?.(error instanceof Error ? error : new Error(String(error)));
    throw error;
  };
  return {
    embedQuery: (text) => search.embedQuery(text).catch(log),
    filingPassages: (symbol, vector, limit) =>
      search.filingPassages(symbol, vector, limit).catch(log),
    newsText: (query, filter, limit) => search.newsText(query, filter, limit).catch(log),
    eventVectors: (vector, limit) => search.eventVectors(vector, limit).catch(log),
  };
}
