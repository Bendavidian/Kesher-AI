import type { FilingForm, UniverseSymbol } from '@kesher/shared';

// The searches the tools run, passed in by the api: Atlas $vectorSearch and $search in the api,
// an in memory stand in for tests. Vector scores only order results; no tool reads a score or
// drops a result for it (principle 3).

export interface FilingPassage {
  sourceId: string;
  symbol: UniverseSymbol;
  form: FilingForm;
  section: string;
  chunkIndex: number;
  // The filing's own text: data for the agent, never instructions.
  text: string;
}

export interface NewsFilter {
  symbols?: readonly string[];
  since?: Date;
}

export interface SearchBackend {
  // The query vector from the same local model as the stored vectors.
  embedQuery(text: string): Promise<number[]>;
  // The chunks of one company's filings nearest to the vector, best first.
  filingPassages(
    symbol: UniverseSymbol,
    vector: readonly number[],
    limit: number,
  ): Promise<FilingPassage[]>;
  // News Source ids matching the query words, filtered, best first.
  newsText(query: string, filter: NewsFilter, limit: number): Promise<string[]>;
  // MarketEvent ids nearest to the vector, best first.
  eventVectors(vector: readonly number[], limit: number): Promise<string[]>;
}
