import { existsSync } from 'node:fs';
import { type MarketData, etInstant, priceReactionFor } from '@kesher/shared';
import { describe, expect, it } from 'vitest';
import { DEMO_SOURCE_ID } from '../seed/config';
import { loadRecording } from '../ingest/recordings';
import { barsPath, createMarketData } from './data';
import { loadReactionFixture } from './fixture';
import { createPriceReactions } from './reactions';

// docs/SPIKE.md check 3: the demo headline came overnight, so every move is from the previous
// regular close (2 Apr 2024) and the windows fall on 3 Apr.
const SPIKE_TABLE = {
  TSM: [-1.16, -0.38, 1.31, 1.25],
  NVDA: [-1.07, -0.9, 0.86, -0.54],
  SMH: [-1.0, -0.68, 0.96, 0.4],
  SPY: [-0.22, -0.07, 0.4, 0.1],
};

const table = (rows: { symbol: string; moves: { pct: number | null }[] }[]) =>
  Object.fromEntries(rows.map((row) => [row.symbol, row.moves.map((move) => move.pct)]));

describe('the committed demo fixture', () => {
  it('holds the SPIKE.md moves, anchored to the previous close', async () => {
    const { reaction } = await loadReactionFixture(DEMO_SOURCE_ID);
    expect(reaction.anchor).toEqual({
      kind: 'previous_close',
      baseTime: new Date('2024-04-02T20:00:00Z'),
      tradingDay: '2024-04-03',
    });
    expect(reaction.windows.map((w) => w.name)).toEqual(['open_gap', '15m', '2h', 'session_close']);
    expect(table(reaction.rows)).toEqual(SPIKE_TABLE);
    expect(reaction.delayed).toBe(true);
    expect(reaction.complete).toBe(true);
  });
});

// Raw SIP bars are a gitignored local cache (SPEC.md decision log, T13), so this runs only where
// npm run record:bars -- --event 38062166 --symbols TSM,NVDA has filled it.
const cached = ['TSM', 'NVDA', 'SMH', 'SPY'].every(
  (symbol) =>
    existsSync(barsPath(symbol, '2024-04-02')) && existsSync(barsPath(symbol, '2024-04-03')),
);
const SKIP_NOTE = cached
  ? ''
  : ' (skipped: no local bar cache; run npm run record:bars -- --event 38062166 --symbols TSM,NVDA)';

describe.skipIf(!cached)(`the demo event from real bars${SKIP_NOTE}`, () => {
  it('reproduces SPIKE.md check 3 and the committed fixture', async () => {
    const recording = await loadRecording(DEMO_SOURCE_ID);
    const headline = new Date(recording!.item.created_at);
    // Keys are never needed: the calendar and the bars come from local files.
    const market = createMarketData({ keys: () => undefined });
    const reaction = await priceReactionFor(market, ['TSM', 'NVDA'], headline, new Date());
    expect(table(reaction.rows)).toEqual(SPIKE_TABLE);
    const { reaction: fixture } = await loadReactionFixture(DEMO_SOURCE_ID);
    expect(reaction).toEqual(fixture);
  });
});

describe('createPriceReactions', () => {
  // Counts the sessions reads; every session has no bars.
  function countingMarket() {
    let reads = 0;
    const market: MarketData = {
      sessions: () => {
        reads++;
        const day = (date: string) => ({
          date,
          open: etInstant(date, '09:30'),
          close: etInstant(date, '16:00'),
        });
        return Promise.resolve([day('2024-04-02'), day('2024-04-03')]);
      },
      bars: (symbols) => Promise.resolve(new Map(symbols.map((symbol) => [symbol, []]))),
    };
    return { market, reads: () => reads };
  }
  const headline = new Date('2024-04-03T03:57:09Z');

  it('keeps a complete reaction and computes an incomplete one again', async () => {
    const complete = countingMarket();
    const later = createPriceReactions(complete.market, { now: () => new Date('2024-05-01') });
    await later(['TSM'], headline);
    await later(['TSM'], headline);
    expect(complete.reads()).toBe(1);
    // Another subject list is another reaction.
    await later(['NVDA'], headline);
    expect(complete.reads()).toBe(2);

    const pending = countingMarket();
    const during = createPriceReactions(pending.market, {
      now: () => etInstant('2024-04-03', '10:00'),
    });
    expect((await during(['TSM'], headline)).complete).toBe(false);
    await during(['TSM'], headline);
    expect(pending.reads()).toBe(2);
  });

  it('drops the oldest reaction beyond the limit', async () => {
    const { market, reads } = countingMarket();
    const reactions = createPriceReactions(market, { now: () => new Date('2024-05-01'), limit: 1 });
    await reactions(['TSM'], headline);
    await reactions(['NVDA'], headline);
    await reactions(['TSM'], headline);
    expect(reads()).toBe(3);
  });
});
