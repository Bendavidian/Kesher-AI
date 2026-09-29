import type { Source } from '@kesher/shared';
import { describe, expect, it } from 'vitest';
import { reportSourceFor } from './report';

const at = new Date('2026-09-29T12:00:00Z');

const news: Omit<Source, 'text'> = {
  _id: '00000000-0000-4000-8000-000000000001',
  provider: 'alpaca',
  kind: 'news',
  tier: 2,
  externalId: '38062166',
  url: 'https://example.com/tsmc',
  author: null,
  publisher: 'Benzinga',
  title: 'TSMC Suspends Chip Production',
  symbols: ['TSM'],
  publishedAt: at,
  injectionScreen: null,
  createdAt: at,
};

const filing: Omit<Source, 'text'> = {
  ...news,
  _id: '00000000-0000-4000-8000-000000000002',
  provider: 'sec_edgar',
  kind: 'filing',
  tier: 1,
  externalId: '0001045810-26-000021',
  publisher: null,
  title: 'NVIDIA 10-K, filed Feb 25, 2026',
  symbols: ['NVDA'],
};

describe('reportSourceFor', () => {
  it('names news by its outlet and provider, cited as a headline by Alpaca id', () => {
    expect(reportSourceFor(news)).toEqual({
      _id: news._id,
      kind: 'news',
      tier: 2,
      title: 'Benzinga via Alpaca',
      citeLabel: 'Benzinga headline',
      ref: 'id 38062166',
    });
  });

  it('falls back to the provider when a news item has no publisher', () => {
    expect(reportSourceFor({ ...news, publisher: null })).toMatchObject({
      title: 'Alpaca',
      citeLabel: 'Alpaca headline',
    });
  });

  it('names a filing by its title and accession number', () => {
    expect(reportSourceFor(filing)).toEqual({
      _id: filing._id,
      kind: 'filing',
      tier: 1,
      title: 'NVIDIA 10-K, filed Feb 25, 2026',
      citeLabel: 'NVIDIA 10-K, filed Feb 25, 2026',
      ref: '0001045810-26-000021',
    });
  });

  it('names a price reaction as SIP bars with its anchor, delayed 15 minutes', () => {
    const bars: Omit<Source, 'text'> = {
      ...news,
      _id: '00000000-0000-4000-8000-000000000003',
      kind: 'market_data',
      tier: 1,
      externalId: 'price_reaction:TSM,NVDA,SMH,SPY:previous_close:2024-04-02T20:00:00.000Z',
      publisher: null,
      title: 'SIP bars for TSM, NVDA, SMH and SPY',
      symbols: ['TSM', 'NVDA', 'SMH', 'SPY'],
    };
    expect(reportSourceFor(bars)).toEqual({
      _id: bars._id,
      kind: 'market_data',
      tier: 1,
      title: 'SIP bars for TSM, NVDA, SMH and SPY',
      citeLabel: 'SIP bars, anchored to the previous regular close on 2024-04-02',
      ref: 'Delayed 15 minutes',
    });
  });
});
