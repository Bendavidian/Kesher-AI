import { describe, expect, it } from 'vitest';
import type { IncomingItem } from './item';
import { changedFields, passesUniverse, repeatReason } from './prefilter';

describe('passesUniverse', () => {
  it('passes an item tagged with a demo universe company', () => {
    expect(passesUniverse(['TSM'])).toBe(true);
    expect(passesUniverse(['TSM', 'SPY'])).toBe(true);
    expect(passesUniverse(['SOXX', 'MU'])).toBe(true);
  });

  it('drops benchmarks alone, companies outside the universe and items with no symbols', () => {
    expect(passesUniverse(['SPY'])).toBe(false);
    expect(passesUniverse(['SPY', 'SMH'])).toBe(false);
    expect(passesUniverse(['AAPL', 'SOXX'])).toBe(false);
    expect(passesUniverse([])).toBe(false);
  });

  it('matches exact symbols only', () => {
    expect(passesUniverse(['tsm'])).toBe(false);
    expect(passesUniverse(['TSM.TW'])).toBe(false);
  });
});

describe('repeatReason', () => {
  const stored: IncomingItem = {
    provider: 'alpaca',
    kind: 'news',
    tier: 2,
    externalId: '38062166',
    url: 'https://www.benzinga.com/news/24/04/38062166/tsmc',
    author: 'Benzinga Neuro',
    title: 'TSMC Suspends Chip Production',
    text: 'Taiwan was struck by a powerful earthquake.',
    symbols: ['TSM', 'NVDA'],
    publishedAt: new Date('2024-04-03T03:57:09Z'),
  };

  it('calls the same item a duplicate, whatever the symbol order', () => {
    const again = {
      ...stored,
      symbols: ['NVDA', 'TSM'],
      publishedAt: new Date(stored.publishedAt),
    };
    expect(changedFields(stored, again)).toEqual([]);
    expect(repeatReason(stored, again)).toBe('duplicate');
  });

  it('calls a changed item an update and names the fields that changed', () => {
    const changed = { ...stored, text: 'Updated body.', symbols: ['TSM'] };
    expect(changedFields(stored, changed)).toEqual(['text', 'symbols']);
    expect(repeatReason(stored, changed)).toBe('update');
  });

  it('sees a changed title, url, author and publish time', () => {
    const changed = {
      ...stored,
      title: 'TSMC Resumes Production',
      url: 'https://www.benzinga.com/news/24/04/38062166/tsmc-update',
      author: null,
      publishedAt: new Date('2024-04-03T04:01:37Z'),
    };
    expect(changedFields(stored, changed)).toEqual(['url', 'author', 'title', 'publishedAt']);
  });
});
