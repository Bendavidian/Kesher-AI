import type { FilingPassage, SearchBackend } from '@kesher/mcp';
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
  };
}
