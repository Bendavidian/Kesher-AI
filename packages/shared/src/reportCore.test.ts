import { describe, expect, it } from 'vitest';
import { FeedEvidence } from './feed';
import { PriceReaction, type PriceSymbol } from './price';
import { pathFactText, priceMetricFor } from './reportCore';

const PREVIOUS_CLOSE = {
  kind: 'previous_close',
  baseTime: new Date('2024-04-02T20:00:00Z'),
  tradingDay: '2024-04-03',
} as const;

const OPEN_WINDOWS = [
  { name: 'open_gap', endsAt: new Date('2024-04-03T13:30:00Z') },
  { name: '15m', endsAt: new Date('2024-04-03T13:45:00Z') },
] as const;

// A row whose first move is pct (null when not ready) and whose second is 0.5.
function row(symbol: PriceSymbol, pct: number | null) {
  return {
    symbol,
    basePrice: 100,
    baseBarTime: new Date('2024-04-02T19:59:00Z'),
    moves: [
      { pct, barTime: pct === null ? null : new Date('2024-04-03T13:30:00Z') },
      { pct: 0.5, barTime: new Date('2024-04-03T13:45:00Z') },
    ],
  };
}

// The demo event's open gap (recordings/price-reactions/38062166.json).
function demoReaction(overrides: Partial<Record<PriceSymbol, number | null>> = {}): PriceReaction {
  const pct = { TSM: -1.16, NVDA: -1.07, SMH: -1, SPY: -0.22, ...overrides };
  return PriceReaction.parse({
    anchor: PREVIOUS_CLOSE,
    windows: OPEN_WINDOWS,
    rows: (['TSM', 'NVDA', 'SMH', 'SPY'] as const).map((symbol) => row(symbol, pct[symbol])),
    delayed: true,
    complete: true,
  });
}

// Every percentage as written, with a true minus read as negative.
function percentages(text: string): number[] {
  return [...text.matchAll(/([+−]?)(\d+\.\d+)%/g)].map(
    ([, sign, digits]) => (sign === '−' ? -1 : 1) * Number(digits),
  );
}

describe('priceMetricFor', () => {
  it('states the event company and the holding at the open, next to SMH and SPY', () => {
    const metric = priceMetricFor(demoReaction(), ['TSM', 'NVDA']);
    expect(metric).toEqual({
      ok: true,
      text: 'TSM opened −1.16% below its previous close and NVDA opened −1.07% below its previous close; SMH −1.00%, SPY −0.22%.',
      figures: [
        { symbol: 'TSM', window: 'open_gap', pct: -1.16 },
        { symbol: 'NVDA', window: 'open_gap', pct: -1.07 },
        { symbol: 'SMH', window: 'open_gap', pct: -1 },
        { symbol: 'SPY', window: 'open_gap', pct: -0.22 },
      ],
    });
  });

  it('names a direct holding once', () => {
    const metric = priceMetricFor(demoReaction(), ['TSM', 'TSM']);
    expect(metric.ok && metric.text).toBe(
      'TSM opened −1.16% below its previous close; SMH −1.00%, SPY −0.22%.',
    );
    expect(metric.ok && metric.figures.map((f) => f.symbol)).toEqual(['TSM', 'SMH', 'SPY']);
  });

  it('words a gain and an unchanged open by their sign', () => {
    const metric = priceMetricFor(demoReaction({ TSM: 0.4, NVDA: 0, SPY: 0.05 }), ['TSM', 'NVDA']);
    expect(metric.ok && metric.text).toBe(
      'TSM opened +0.40% above its previous close and NVDA opened at its previous close, 0.00%; SMH −1.00%, SPY +0.05%.',
    );
  });

  it('counts from the headline when it fell inside a session', () => {
    const reaction = PriceReaction.parse({
      anchor: { ...PREVIOUS_CLOSE, kind: 'headline', baseTime: new Date('2024-04-03T15:00:00Z') },
      windows: [
        { name: '15m', endsAt: new Date('2024-04-03T15:15:00Z') },
        { name: '2h', endsAt: new Date('2024-04-03T17:00:00Z') },
      ],
      rows: (['NVDA', 'SMH', 'SPY'] as const).map((symbol) => row(symbol, -0.4)),
      delayed: true,
      complete: false,
    });
    const metric = priceMetricFor(reaction, ['NVDA']);
    expect(metric).toMatchObject({
      ok: true,
      text: 'NVDA moved −0.40% in the 15 minutes after the headline; SMH −0.40%, SPY −0.40%.',
    });
    expect(metric.ok && metric.figures.every((f) => f.window === '15m')).toBe(true);
  });

  it('is not ready while a needed move is pending, even a benchmark', () => {
    expect(priceMetricFor(demoReaction({ NVDA: null }), ['TSM', 'NVDA'])).toEqual({
      ok: false,
      reason: 'not_ready',
    });
    expect(priceMetricFor(demoReaction({ SPY: null }), ['TSM'])).toEqual({
      ok: false,
      reason: 'not_ready',
    });
  });

  it('is unavailable when the reaction has no row for a subject', () => {
    expect(priceMetricFor(demoReaction(), ['AMD'])).toEqual({ ok: false, reason: 'unavailable' });
  });

  it('writes only its figures, and never a cause', () => {
    for (const subjects of [['TSM', 'NVDA'], ['TSM']] as const) {
      const metric = priceMetricFor(demoReaction(), subjects);
      if (!metric.ok) throw new Error('expected a metric');
      expect(percentages(metric.text)).toEqual(metric.figures.map((f) => f.pct));
      expect(metric.text).not.toMatch(/caus|because|due to|driv|led to|result/i);
    }
  });
});

describe('pathFactText', () => {
  const evidence = FeedEvidence.parse({
    relationshipId: '0b8c3f7e-2f4a-4a51-8d0e-2a4f5c6d7e81',
    from: 'TSM',
    to: 'NVDA',
    type: 'supplier_of',
    quote: 'We utilize foundries, such as Taiwan Semiconductor Manufacturing Company Limited.',
    filingDate: '2024-02-21',
    url: 'https://www.sec.gov/Archives/edgar/data/1045810/000104581024000029/nvda-20240128.htm',
    reviewed: true,
    filing: {
      sourceId: '6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b',
      symbol: 'NVDA',
      title: 'NVIDIA 10-K 2024',
      form: '10-K',
      tier: 1,
    },
  });

  it('states the hop and names the filing it quotes', () => {
    expect(pathFactText(evidence)).toBe("TSMC supplies NVIDIA, according to NVIDIA's 10-K.");
  });

  it('reads the hop in its own direction', () => {
    expect(
      pathFactText({
        ...evidence,
        from: 'NVDA',
        to: 'TSM',
        type: 'customer_of',
        filing: { ...evidence.filing, symbol: 'TSM', form: '20-F' },
      }),
    ).toBe("NVIDIA is a customer of TSMC, according to TSMC's 20-F.");
  });
});
