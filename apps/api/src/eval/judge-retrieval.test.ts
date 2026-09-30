import { describe, expect, it } from 'vitest';
import { judged, parseJudgement } from './judge-retrieval';
import { RetrievalQuery } from './retrieval';

describe('parseJudgement', () => {
  it.each([
    ['2 1', { kind: 'relevant', indexes: [1, 2] }],
    ['3,3, 5', { kind: 'relevant', indexes: [3, 5] }],
    ['0', { kind: 'relevant', indexes: [] }],
    ['s', { kind: 'skip' }],
    ['q', { kind: 'quit' }],
    ['11', null],
    ['0 1', null],
    ['one', null],
    ['', null],
  ])('%j', (input, expected) => {
    expect(parseJudgement(input, 10)).toEqual(expected);
  });
});

describe('judged', () => {
  it('records the chosen results by key and excerpt and passes the schema', () => {
    const query = {
      id: 'q01',
      query: 'foundry dependency',
      symbol: 'NVDA',
      status: 'proposed',
      relevant: [],
    } satisfies RetrievalQuery;
    const hit = (key: string) => ({
      key,
      excerpt: `text of ${key}`,
      symbol: 'NVDA',
      section: 'Item 1A',
      text: '',
    });
    const now = new Date('2026-09-29T12:00:00.000Z');
    const result = judged(query, [hit('NVDA#4'), hit('NVDA#9'), hit('NVDA#1')], [1, 3], now);
    expect(RetrievalQuery.parse(result)).toEqual({
      id: 'q01',
      query: 'foundry dependency',
      symbol: 'NVDA',
      status: 'reviewed',
      relevant: [
        { key: 'NVDA#4', excerpt: 'text of NVDA#4' },
        { key: 'NVDA#1', excerpt: 'text of NVDA#1' },
      ],
      decidedAt: now.toISOString(),
    });
  });
});
