import { describe, expect, it } from 'vitest';
import { Source } from './domain/source';
import {
  anchorNote,
  parsePriceReactionExternalId,
  priceReactionExternalId,
  priceReactionSource,
  priceReactionText,
} from './marketSource';
import type { PriceReaction } from './price';

const reaction: PriceReaction = {
  anchor: {
    kind: 'previous_close',
    baseTime: new Date('2024-04-02T20:00:00Z'),
    tradingDay: '2024-04-03',
  },
  windows: [
    { name: 'open_gap', endsAt: new Date('2024-04-03T13:30:00Z') },
    { name: '15m', endsAt: new Date('2024-04-03T13:45:00Z') },
  ],
  rows: [
    {
      symbol: 'TSM',
      basePrice: 142.5,
      baseBarTime: new Date('2024-04-02T19:59:00Z'),
      moves: [
        { pct: -1.16, barTime: new Date('2024-04-03T13:30:00Z') },
        { pct: 0.4, barTime: new Date('2024-04-03T13:44:00Z') },
      ],
    },
    {
      symbol: 'SPY',
      basePrice: null,
      baseBarTime: null,
      moves: [
        { pct: null, barTime: null },
        { pct: null, barTime: null },
      ],
    },
  ],
  delayed: true,
  complete: false,
};

describe('the price reaction Source', () => {
  it('names one source per symbols and anchor, and parses its id back', () => {
    const id = priceReactionExternalId(reaction);
    expect(id).toBe('price_reaction:TSM,SPY:previous_close:2024-04-02T20:00:00.000Z');
    expect(parsePriceReactionExternalId(id)).toEqual({
      symbols: ['TSM', 'SPY'],
      kind: 'previous_close',
      baseTime: reaction.anchor.baseTime,
    });
    expect(parsePriceReactionExternalId('0001045810-26-000021')).toBeNull();
  });

  it('states the anchor in ET and never a cause', () => {
    expect(anchorNote('previous_close', reaction.anchor.baseTime)).toBe(
      'anchored to the previous regular close on 2024-04-02',
    );
    expect(priceReactionText(reaction)).toBe(
      [
        'SIP minute bars, delayed 15 minutes, anchored to the previous regular close on 2024-04-02 (trading day 2024-04-03). Moves show timing only, never a cause.',
        'TSM: base 142.50; open_gap -1.16%, 15m +0.40%',
        'SPY: no base price; open_gap not available yet, 15m not available yet',
      ].join('\n'),
    );
  });

  it('builds a valid market_data Source from alpaca', () => {
    const id = '1b0c2d3e-4f50-5a6b-8c7d-9e0f1a2b3c4d';
    const source = priceReactionSource(reaction, id, new Date('2026-09-29T00:00:00Z'));
    expect(Source.safeParse(source).success).toBe(true);
    expect(source).toMatchObject({
      _id: id,
      provider: 'alpaca',
      kind: 'market_data',
      tier: 1,
      title: 'SIP bars for TSM and SPY',
      symbols: ['TSM', 'SPY'],
      publishedAt: reaction.anchor.baseTime,
      injectionScreen: null,
    });
    expect(source.url).not.toMatch(/key|secret/i);
  });
});
