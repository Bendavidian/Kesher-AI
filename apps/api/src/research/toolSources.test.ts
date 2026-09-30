import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { collectPassages, PASSAGE_SEPARATOR, withPassages } from './toolSources';

const tenK = randomUUID();
const QUOTE = 'We utilize foundries, such as Taiwan Semiconductor Manufacturing Company Limited.';

describe('collectPassages', () => {
  it('keeps search_filings passages and evidence quotes by source, and nothing else', () => {
    const into = new Map<string, string[]>();
    collectPassages(
      'search_filings',
      {
        passages: [
          {
            sourceId: tenK,
            symbol: 'NVDA',
            form: '10-K',
            section: 'Item 1A. Risk Factors',
            chunkIndex: 4,
            text: 'We depend on foundries.',
            sourceTitle: 'NVIDIA 10-K',
            url: 'https://www.sec.gov/x',
          },
        ],
        omitted: 0,
      },
      into,
    );
    collectPassages(
      'get_company_relationships',
      {
        edges: [
          {
            from: 'NVDA',
            to: 'TSM',
            type: 'customer_of',
            evidence: {
              sourceId: tenK,
              quote: QUOTE,
              filingDate: '2026-02-25',
              url: 'https://www.sec.gov/x',
            },
            sourceTitle: 'NVIDIA 10-K',
          },
        ],
        omitted: 0,
      },
      into,
    );
    // Untrusted news excerpts are checked against the stored Source text, never collected here.
    collectPassages('search_news', { items: [{ sourceId: tenK, excerpt: 'x' }] }, into);
    collectPassages('search_filings', { passages: 'not a list' }, into);

    expect(into).toEqual(new Map([[tenK, ['We depend on foundries.', QUOTE]]]));
  });
});

describe('withPassages', () => {
  const filing = { _id: tenK, title: 'NVIDIA 10-K', text: null };

  it('gives a filing the returned passages as its text, once each', () => {
    expect(withPassages(filing, ['a passage', QUOTE, 'a passage']).text).toBe(
      ['a passage', QUOTE].join(PASSAGE_SEPARATOR),
    );
  });

  it('keeps a source with text, and a filing nothing came back for', () => {
    const news = { ...filing, text: 'body' };
    expect(withPassages(news, [QUOTE])).toBe(news);
    expect(withPassages(filing, undefined)).toBe(filing);
    expect(withPassages(filing, [])).toBe(filing);
  });
});
