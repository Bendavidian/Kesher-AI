import { describe, expect, it } from 'vitest';
import { fuseRanks, matchedTerms, queryTerms, RRF_K } from './news';

const doc = (id: string, iso: string) => ({ _id: id, publishedAt: new Date(iso) });
const ranks = (...ids: string[]) => new Map(ids.map((id, i) => [id, i]));

describe('queryTerms and matchedTerms', () => {
  it('lowercases, dedupes and caps the terms', () => {
    expect(queryTerms('  TSMC  tsmc Earthquake ')).toEqual(['tsmc', 'earthquake']);
    expect(queryTerms('a b c d e f g h i j')).toHaveLength(8);
  });

  it('counts distinct terms in the title or body, and 0 for none', () => {
    expect(matchedTerms('TSMC halts fabs', 'after an earthquake', ['tsmc', 'earthquake'])).toBe(2);
    expect(matchedTerms('Chipmaker pauses output', null, ['tsmc'])).toBe(0);
  });
});

describe('fuseRanks', () => {
  const a = doc('a', '2024-04-03T00:00:00Z');
  const b = doc('b', '2024-04-04T00:00:00Z');
  const c = doc('c', '2024-04-05T00:00:00Z');
  const d = doc('d', '2024-04-06T00:00:00Z');

  it('puts an item that both lists rank above items that only one list ranks', () => {
    // b is second in both lists; a and c are first in only one each.
    expect(fuseRanks([a, b, c], [ranks('a', 'b'), ranks('c', 'b')])).toEqual([b, c, a]);
  });

  it('weights rank by 1 / (60 + position)', () => {
    // Third in one list beats first in neither and loses to second in both.
    expect(1 / (RRF_K + 3)).toBeLessThan(2 / (RRF_K + 2));
    expect(fuseRanks([a, b], [ranks('x', 'y', 'a'), ranks('b')])).toEqual([b, a]);
  });

  it('breaks ties by the newest item, then the id', () => {
    expect(fuseRanks([a, d], [ranks('a'), ranks('d')])).toEqual([d, a]);
    const twin = doc('0', a.publishedAt.toISOString());
    expect(fuseRanks([a, twin], [ranks('a'), ranks('0')])).toEqual([twin, a]);
  });

  it('drops candidates in neither list, never filters on anything else, and caps the list', () => {
    expect(fuseRanks([a, b, c], [ranks('a'), ranks()])).toEqual([a]);
    const many = Array.from({ length: 15 }, (_, i) => doc(`n${i}`, '2024-04-03T00:00:00Z'));
    const all = ranks(...many.map((m) => m._id));
    expect(fuseRanks(many, [all, new Map()])).toHaveLength(10);
    expect(fuseRanks(many, [all, new Map()], 15)).toHaveLength(15);
  });
});
