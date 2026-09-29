import { describe, expect, it } from 'vitest';
import { filingPassagesPipeline } from './atlas';

describe('filingPassagesPipeline', () => {
  it('asks filing_chunks_vector for one filer, with no score in the output', () => {
    const vector = [0.1, 0.2];
    const [search, project] = filingPassagesPipeline('NVDA', vector, 3);
    expect(search).toEqual({
      $vectorSearch: {
        index: 'filing_chunks_vector',
        path: 'embedding',
        queryVector: vector,
        numCandidates: 150,
        limit: 3,
        filter: { symbol: 'NVDA' },
      },
    });
    // The score only orders the results; it never reaches a tool.
    expect(JSON.stringify(project)).not.toContain('vectorSearchScore');
    expect(project).toEqual({
      $project: { _id: 0, sourceId: 1, symbol: 1, form: 1, section: 1, chunkIndex: 1, text: 1 },
    });
  });
});
