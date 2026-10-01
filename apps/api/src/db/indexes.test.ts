import { describe, expect, it } from 'vitest';
import { COLLECTION_NAMES } from './collections';
import { INDEXES, SEARCH_INDEXES } from './indexes';

const uniqueKeys = (name: keyof typeof INDEXES) =>
  INDEXES[name].filter((index) => index.unique).map((index) => Object.keys(index.key));

describe('indexes', () => {
  it('covers every collection', () => {
    expect(Object.keys(INDEXES).sort()).toEqual([...COLLECTION_NAMES].sort());
  });

  it('makes every natural key unique', () => {
    expect(uniqueKeys('users')).toEqual([['email']]);
    expect(uniqueKeys('companies')).toEqual([['symbol'], ['cik']]);
    expect(uniqueKeys('relationships')).toEqual([['from', 'to', 'type']]);
    expect(uniqueKeys('sources')).toEqual([['provider', 'externalId']]);
    expect(uniqueKeys('market_events')).toEqual([['sourceIds']]);
    expect(uniqueKeys('feed_items')).toEqual([['userId', 'eventId']]);
    expect(uniqueKeys('reports')).toEqual([['runId']]);
    expect(uniqueKeys('filing_chunks')).toEqual([['sourceId', 'chunkIndex']]);
    expect(uniqueKeys('ingest_counters')).toEqual([['day', 'mode', 'reason']]);
    expect(uniqueKeys('research_budget')).toEqual([['day']]);
    expect(uniqueKeys('ingest_budget')).toEqual([['day']]);
  });

  it('names every index', () => {
    for (const name of COLLECTION_NAMES) {
      for (const index of INDEXES[name]) expect(index.name).toBeTruthy();
    }
  });
});

const vectorIndexes = () => SEARCH_INDEXES.filter((s) => s.index.type === 'vectorSearch');

describe('search indexes', () => {
  it('index event and filing chunk embeddings at 384 dimensions, cosine', () => {
    expect(vectorIndexes().map((s) => s.collection)).toEqual(['market_events', 'filing_chunks']);
    for (const { index } of vectorIndexes()) {
      if (index.type !== 'vectorSearch') continue;
      expect(index.definition.fields).toContainEqual({
        type: 'vector',
        path: 'embedding',
        numDimensions: 384,
        similarity: 'cosine',
      });
    }
  });

  it('lets filing search filter by symbol', () => {
    const filings = SEARCH_INDEXES.find((s) => s.collection === 'filing_chunks');
    expect(
      filings?.index.type === 'vectorSearch' && filings.index.definition.fields,
    ).toContainEqual({ type: 'filter', path: 'symbol' });
  });

  it('indexes the text of sources with the fields search_news filters on', () => {
    const text = SEARCH_INDEXES.find((s) => s.index.name === 'sources_text');
    expect(text?.collection).toBe('sources');
    expect(text?.index.type).toBe('search');
    expect(text?.index.type === 'search' && text.index.definition.mappings).toEqual({
      dynamic: false,
      fields: {
        title: { type: 'string' },
        text: { type: 'string' },
        kind: { type: 'token' },
        symbols: { type: 'token' },
        publishedAt: { type: 'date' },
      },
    });
  });

  it('uses all 3 search indexes of the Atlas free tier and no more', () => {
    expect(SEARCH_INDEXES).toHaveLength(3);
  });
});
