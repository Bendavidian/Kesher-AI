import { PriceReaction } from '@kesher/shared';
import { describe, expect, it } from 'vitest';
import demo from '../../../../recordings/price-reactions/38062166.json';
import { reviveDates } from '../api/decode';
import { DEMO_PRICE_REACTION } from '../fixtures/demoEvent';
import { priceReactionView } from './price';

// The committed PriceReaction of the demo event, computed by the api from real bars.
const reaction = PriceReaction.parse(reviveDates(demo.reaction));

describe('priceReactionView', () => {
  it('turns the demo reaction into the SPIKE.md table the fixtures hold', () => {
    const view = priceReactionView(reaction);
    expect(view.windows).toEqual(DEMO_PRICE_REACTION.windows);
    expect(view.rows).toEqual(DEMO_PRICE_REACTION.rows);
    expect(view.delayNote).toBe(DEMO_PRICE_REACTION.delayNote);
    expect(view.anchor.kind).toBe('previous_close');
    // The previous regular close, 4:00 PM ET on 2 Apr, and the trading day 3 Apr.
    expect(view.anchor.baseAt.toISOString()).toBe('2024-04-02T20:00:00.000Z');
    expect(view.anchor.tradingDay.toISOString()).toBe('2024-04-03T12:00:00.000Z');
  });

  it('labels windows from the headline for a headline in the session, and keeps nulls', () => {
    const during = priceReactionView({
      ...reaction,
      anchor: { ...reaction.anchor, kind: 'headline', baseTime: new Date('2024-04-03T14:00:00Z') },
      windows: reaction.windows.slice(1),
      rows: reaction.rows.map((row) => ({
        ...row,
        moves: [row.moves[1]!, { pct: null, barTime: null }, { pct: null, barTime: null }],
      })),
    });
    expect(during.windows).toEqual([
      '15 min after headline',
      '2 h after headline',
      'Session close',
    ]);
    expect(during.rows[0]!.moves).toEqual([-0.38, null, null]);
  });
});
