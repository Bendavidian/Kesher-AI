import { describe, expect, it } from 'vitest';
import { eventVectorsPipeline, filingPassagesPipeline, newsTextPipeline } from './atlas';

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

describe('newsTextPipeline', () => {
  it('searches the title and body of news on sources_text, filtered inside the search', () => {
    const since = new Date('2024-04-01T00:00:00Z');
    const [search, limit, project] = newsTextPipeline(
      'TSMC earthquake',
      { symbols: ['TSM'], since },
      50,
    );
    expect(search).toEqual({
      $search: {
        index: 'sources_text',
        compound: {
          must: [{ text: { query: 'TSMC earthquake', path: ['title', 'text'] } }],
          filter: [
            { equals: { path: 'kind', value: 'news' } },
            { in: { path: 'symbols', value: ['TSM'] } },
            { range: { path: 'publishedAt', gte: since } },
          ],
        },
      },
    });
    expect(limit).toEqual({ $limit: 50 });
    expect(project).toEqual({ $project: { _id: 1 } });
  });

  it('keeps only the news filter without symbols or since', () => {
    const [search] = newsTextPipeline('TSMC', {}, 50);
    expect(JSON.stringify(search)).not.toContain('symbols');
    expect(JSON.stringify(search)).not.toContain('publishedAt');
  });
});

describe('eventVectorsPipeline', () => {
  it('asks market_events_vector for ids only, never a score', () => {
    const [search, project] = eventVectorsPipeline([0.5], 50);
    expect(search).toEqual({
      $vectorSearch: {
        index: 'market_events_vector',
        path: 'embedding',
        queryVector: [0.5],
        numCandidates: 500,
        limit: 50,
      },
    });
    expect(project).toEqual({ $project: { _id: 1 } });
  });
});
