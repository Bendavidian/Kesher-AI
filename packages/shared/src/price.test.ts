import { describe, expect, it } from 'vitest';
import {
  type MarketData,
  type MarketSession,
  type MinuteBar,
  type PriceSymbol,
  PriceReaction,
  computeReaction,
  etDate,
  etInstant,
  priceReactionFor,
  resolveAnchor,
} from './price';

const session = (date: string, close = '16:00'): MarketSession => ({
  date,
  open: etInstant(date, '09:30'),
  close: etInstant(date, close),
});

// The Alpaca market calendar around the demo event and Thanksgiving 2024: weekends, Good Friday
// (29 Mar 2024) and Thanksgiving (28 Nov 2024) are absent, and 29 Nov 2024 closes at 13:00.
const CALENDAR: MarketSession[] = [
  ...['2024-03-27', '2024-03-28', '2024-04-01', '2024-04-02', '2024-04-03', '2024-04-04'],
  ...['2024-04-05', '2024-04-08', '2024-04-09', '2024-11-26', '2024-11-27'],
].map((date) => session(date));
CALENDAR.push(session('2024-11-29', '13:00'), session('2024-12-02'), session('2024-12-03'));
CALENDAR.sort((a, b) => a.open.getTime() - b.open.getTime());

const utc = (iso: string) => new Date(iso);
const minutes = (n: number) => n * 60_000;

describe('etInstant and etDate', () => {
  it('turns an ET wall clock time into an instant across daylight saving', () => {
    expect(etInstant('2024-03-08', '09:30').toISOString()).toBe('2024-03-08T14:30:00.000Z');
    expect(etInstant('2024-03-11', '09:30').toISOString()).toBe('2024-03-11T13:30:00.000Z');
    expect(etInstant('2024-11-29', '13:00').toISOString()).toBe('2024-11-29T18:00:00.000Z');
  });

  it('gives the ET date of an instant', () => {
    // 23:57 ET on 2 Apr.
    expect(etDate(utc('2024-04-03T03:57:09Z'))).toBe('2024-04-02');
    expect(etDate(utc('2024-04-03T04:00:00Z'))).toBe('2024-04-03');
  });

  it('handles midnight ET as hour 0', () => {
    expect(etInstant('2024-04-03', '00:00').toISOString()).toBe('2024-04-03T04:00:00.000Z');
    expect(etInstant('2024-04-03', '00:30').toISOString()).toBe('2024-04-03T04:30:00.000Z');
  });
});

describe('resolveAnchor', () => {
  const anchorOf = (iso: string) => {
    const resolved = resolveAnchor(CALENDAR, utc(iso));
    if (!resolved) throw new Error('no anchor');
    return {
      kind: resolved.anchor.kind,
      baseTime: resolved.anchor.baseTime.toISOString(),
      tradingDay: resolved.anchor.tradingDay,
      windows: resolved.windows.map((w) => `${w.name} ${w.endsAt.toISOString()}`),
    };
  };

  it('anchors the overnight demo headline to the previous close and the next session', () => {
    expect(anchorOf('2024-04-03T03:57:09Z')).toEqual({
      kind: 'previous_close',
      baseTime: '2024-04-02T20:00:00.000Z',
      tradingDay: '2024-04-03',
      windows: [
        'open_gap 2024-04-03T13:30:00.000Z',
        '15m 2024-04-03T13:45:00.000Z',
        '2h 2024-04-03T15:30:00.000Z',
        'session_close 2024-04-03T20:00:00.000Z',
      ],
    });
  });

  it('anchors a weekend headline to Friday close and Monday', () => {
    const anchor = anchorOf('2024-04-06T15:00:00Z');
    expect(anchor.kind).toBe('previous_close');
    expect(anchor.baseTime).toBe('2024-04-05T20:00:00.000Z');
    expect(anchor.tradingDay).toBe('2024-04-08');
  });

  it('anchors a holiday headline to the close before it and the session after it', () => {
    // Good Friday, during what would be regular hours.
    const anchor = anchorOf('2024-03-29T15:00:00Z');
    expect(anchor.kind).toBe('previous_close');
    expect(anchor.baseTime).toBe('2024-03-28T20:00:00.000Z');
    expect(anchor.tradingDay).toBe('2024-04-01');
  });

  it('treats a headline after an early close as outside the session', () => {
    // 13:30 ET on 29 Nov 2024, after the 13:00 close; the next session is Monday.
    const anchor = anchorOf('2024-11-29T18:30:00Z');
    expect(anchor.kind).toBe('previous_close');
    expect(anchor.baseTime).toBe('2024-11-29T18:00:00.000Z');
    expect(anchor.tradingDay).toBe('2024-12-02');
  });

  it('caps the windows of a headline on an early close day at the close', () => {
    // 12:00 ET on 29 Nov 2024: 2 hours later is past the 13:00 close.
    expect(anchorOf('2024-11-29T17:00:00Z')).toEqual({
      kind: 'headline',
      baseTime: '2024-11-29T17:00:00.000Z',
      tradingDay: '2024-11-29',
      windows: [
        '15m 2024-11-29T17:15:00.000Z',
        '2h 2024-11-29T18:00:00.000Z',
        'session_close 2024-11-29T18:00:00.000Z',
      ],
    });
  });

  it('anchors a premarket headline to the same day session', () => {
    const anchor = anchorOf('2024-04-03T12:00:00Z');
    expect(anchor.kind).toBe('previous_close');
    expect(anchor.baseTime).toBe('2024-04-02T20:00:00.000Z');
    expect(anchor.tradingDay).toBe('2024-04-03');
  });

  it('counts the open as inside the session and the close as outside', () => {
    expect(anchorOf('2024-04-03T13:30:00Z').kind).toBe('headline');
    const atClose = anchorOf('2024-04-03T20:00:00Z');
    expect(atClose.kind).toBe('previous_close');
    expect(atClose.baseTime).toBe('2024-04-03T20:00:00.000Z');
    expect(atClose.tradingDay).toBe('2024-04-04');
  });

  it('gives null without a session on both sides', () => {
    expect(resolveAnchor(CALENDAR, utc('2024-12-04T03:00:00Z'))).toBeNull();
    expect(resolveAnchor(CALENDAR, utc('2024-03-27T03:00:00Z'))).toBeNull();
  });
});

// Synthetic minute bars: one bar at each given ET time, open and close as given.
function bars(date: string, rows: [string, number, number][]): MinuteBar[] {
  return rows.map(([time, o, c]) => ({ t: etInstant(date, time), o, c }));
}

const LATER = utc('2024-06-01T00:00:00Z');

describe('computeReaction', () => {
  const demo = resolveAnchor(CALENDAR, utc('2024-04-03T03:57:09Z'))!;
  const tsm = [
    ...bars('2024-04-02', [
      ['15:58', 140.1, 140.2],
      ['15:59', 140.2, 140.0],
    ]),
    ...bars('2024-04-03', [
      ['09:30', 138.37, 138.6],
      ['09:44', 139.0, 139.1],
      ['09:45', 139.2, 139.47],
      ['11:29', 141.0, 141.5],
      ['11:30', 141.6, 141.83],
      ['15:59', 141.7, 141.75],
    ]),
  ];

  it('measures each window from the previous close, the open gap from the first open', () => {
    const reaction = computeReaction({
      ...demo,
      bars: new Map([['TSM', tsm]]),
      symbols: ['TSM'],
      now: LATER,
    });
    expect(reaction.complete).toBe(true);
    expect(reaction.delayed).toBe(true);
    const [row] = reaction.rows;
    expect(row).toMatchObject({ symbol: 'TSM', basePrice: 140.0 });
    expect(row!.baseBarTime).toEqual(etInstant('2024-04-02', '15:59'));
    expect(row!.moves.map((move) => move.pct)).toEqual([-1.16, -0.38, 1.31, 1.25]);
    expect(row!.moves.map((move) => move.barTime)).toEqual([
      etInstant('2024-04-03', '09:30'),
      etInstant('2024-04-03', '09:45'),
      etInstant('2024-04-03', '11:30'),
      etInstant('2024-04-03', '15:59'),
    ]);
    expect(() => PriceReaction.parse(reaction)).not.toThrow();
  });

  it('rejects a move with only one of pct and barTime', () => {
    const reaction = computeReaction({
      ...demo,
      bars: new Map([['TSM', tsm]]),
      symbols: ['TSM'],
      now: LATER,
    });
    reaction.rows[0]!.moves[0] = { pct: 1, barTime: null };
    expect(() => PriceReaction.parse(reaction)).toThrow('null together');
  });

  it('measures from the price at the headline during a session', () => {
    const during = resolveAnchor(CALENDAR, utc('2024-04-03T14:00:30Z'))!;
    const reaction = computeReaction({
      ...during,
      bars: new Map([
        [
          'TSM',
          bars('2024-04-03', [
            ['09:59', 99, 99.5],
            ['10:00', 99.5, 100],
            ['10:14', 100, 101],
            ['10:15', 101, 102],
            ['12:00', 98, 97],
            ['15:59', 105, 105.5],
          ]),
        ],
      ]),
      symbols: ['TSM'],
      now: LATER,
    });
    expect(reaction.anchor.kind).toBe('headline');
    expect(reaction.windows.map((w) => w.name)).toEqual(['15m', '2h', 'session_close']);
    const [row] = reaction.rows;
    // The base is the 10:00 bar, the last one starting at or before the headline.
    expect(row!.basePrice).toBe(100);
    expect(row!.moves.map((move) => move.pct)).toEqual([2, -3, 5.5]);
  });

  it('leaves windows under 15 minutes old empty and the result incomplete', () => {
    // 09:55 ET: the open gap is 25 minutes old, the 15 minute window only 10.
    const now = etInstant('2024-04-03', '09:55');
    const reaction = computeReaction({
      ...demo,
      bars: new Map([['TSM', tsm.filter((bar) => bar.t.getTime() < now.getTime() - minutes(16))]]),
      symbols: ['TSM'],
      now,
    });
    expect(reaction.complete).toBe(false);
    expect(reaction.rows[0]!.moves).toEqual([
      { pct: -1.16, barTime: etInstant('2024-04-03', '09:30') },
      { pct: null, barTime: null },
      { pct: null, barTime: null },
      { pct: null, barTime: null },
    ]);
  });

  it('uses a bar only once it closed 15 minutes ago, even when a newer one is passed in', () => {
    const pcts = (now: Date) =>
      computeReaction({
        ...demo,
        bars: new Map([['TSM', tsm]]),
        symbols: ['TSM'],
        now,
      }).rows[0]!.moves.map((move) => move.pct);
    // The 09:45 bar closes at 09:46, so the 15 minute window is ready at 10:01, not at 10:00.
    expect(pcts(etInstant('2024-04-03', '10:00'))).toEqual([-1.16, null, null, null]);
    expect(pcts(etInstant('2024-04-03', '10:01'))).toEqual([-1.16, -0.38, null, null]);
  });

  it('gives null moves without bars and a null base without a base bar', () => {
    const reaction = computeReaction({
      ...demo,
      bars: new Map([['SPY', bars('2024-04-03', [['09:30', 520, 521]])]]),
      symbols: ['NVDA', 'SPY'],
      now: LATER,
    });
    expect(reaction.rows[0]).toEqual({
      symbol: 'NVDA',
      basePrice: null,
      baseBarTime: null,
      moves: Array.from({ length: 4 }, () => ({ pct: null, barTime: null })),
    });
    expect(reaction.rows[1]!.basePrice).toBeNull();
    expect(reaction.rows[1]!.moves.every((move) => move.pct === null)).toBe(true);
  });

  it('ignores bars outside the regular session', () => {
    const extended = [
      ...tsm,
      ...bars('2024-04-02', [['19:59', 150, 150]]),
      ...bars('2024-04-03', [
        ['04:00', 120, 120],
        ['16:30', 160, 160],
      ]),
    ].sort((a, b) => a.t.getTime() - b.t.getTime());
    const reaction = computeReaction({
      ...demo,
      bars: new Map([['TSM', extended]]),
      symbols: ['TSM'],
      now: LATER,
    });
    expect(reaction.rows[0]!.basePrice).toBe(140.0);
    expect(reaction.rows[0]!.moves.map((move) => move.pct)).toEqual([-1.16, -0.38, 1.31, 1.25]);
  });

  it('gives no base until the bar at the headline closed 15 minutes ago', () => {
    const during = resolveAnchor(CALENDAR, utc('2024-04-03T14:00:30Z'))!;
    const early = bars('2024-04-03', [
      ['09:30', 99, 99.5],
      ['09:49', 99.5, 99.8],
      ['10:00', 99.8, 100],
    ]);
    const at = (now: Date) =>
      computeReaction({ ...during, bars: new Map([['TSM', early]]), symbols: ['TSM'], now })
        .rows[0]!;
    // At 10:05 the newest settled bar is 09:49, which is not the bar at the headline.
    expect(at(etInstant('2024-04-03', '10:05'))).toMatchObject({
      basePrice: null,
      baseBarTime: null,
    });
    // The 10:00 bar closes at 10:01, so the base is final at 10:16.
    expect(at(etInstant('2024-04-03', '10:16')).basePrice).toBe(100);
  });

  it('gives no previous close base until that session closed 15 minutes ago', () => {
    const atClose = resolveAnchor(CALENDAR, utc('2024-04-02T20:00:00Z'))!;
    const reaction = computeReaction({
      ...atClose,
      bars: new Map([['TSM', tsm]]),
      symbols: ['TSM'],
      now: etInstant('2024-04-02', '16:10'),
    });
    expect(reaction.rows[0]!.basePrice).toBeNull();
  });

  it('repeats the base in a headline window with no later bar', () => {
    // 15:59:30 ET: only the 15:59 bar, which starts before the headline.
    const late = resolveAnchor(CALENDAR, utc('2024-04-03T19:59:30Z'))!;
    const reaction = computeReaction({
      ...late,
      bars: new Map([['TSM', bars('2024-04-03', [['15:59', 100, 101]])]]),
      symbols: ['TSM'],
      now: LATER,
    });
    expect(reaction.rows[0]!.moves.map((move) => move.pct)).toEqual([0, 0, 0]);
  });

  it('reads bars in time order whatever order they arrive in', () => {
    const reaction = computeReaction({
      ...demo,
      bars: new Map([['TSM', [...tsm].reverse()]]),
      symbols: ['TSM'],
      now: LATER,
    });
    expect(reaction.rows[0]!.moves.map((move) => move.pct)).toEqual([-1.16, -0.38, 1.31, 1.25]);
  });

  it('never gives negative zero', () => {
    const flat = [
      ...bars('2024-04-02', [['15:59', 100, 100]]),
      ...bars('2024-04-03', [['09:30', 99.999, 99.999]]),
    ];
    const reaction = computeReaction({
      ...demo,
      bars: new Map([['TSM', flat]]),
      symbols: ['TSM'],
      now: LATER,
    });
    expect(Object.is(reaction.rows[0]!.moves[0]!.pct, 0)).toBe(true);
  });
});

describe('priceReactionFor', () => {
  function fakeMarket(barsFor: Record<string, MinuteBar[]>) {
    const calls: { symbols: readonly PriceSymbol[]; date: string; until: string }[] = [];
    const market: MarketData = {
      sessions: (from, to) =>
        Promise.resolve(CALENDAR.filter((s) => s.date >= from && s.date <= to)),
      bars(symbols, s, until) {
        calls.push({ symbols, date: s.date, until: until.toISOString() });
        const read = new Map(
          symbols.map((symbol) => [
            symbol,
            (barsFor[symbol] ?? []).filter(
              (bar) =>
                bar.t >= s.open &&
                bar.t < s.close &&
                bar.t.getTime() + minutes(1) <= until.getTime(),
            ),
          ]),
        );
        return Promise.resolve(read);
      },
    };
    return { market, calls };
  }

  it('appends SMH and SPY, reads both sessions, and computes every row', async () => {
    const { market, calls } = fakeMarket({
      TSM: bars('2024-04-02', [['15:59', 100, 100]]).concat(
        bars('2024-04-03', [['09:30', 99, 101]]),
      ),
      SMH: bars('2024-04-02', [['15:59', 200, 200]]).concat(
        bars('2024-04-03', [['09:30', 198, 199]]),
      ),
    });
    const reaction = await priceReactionFor(market, ['TSM'], utc('2024-04-03T03:57:09Z'), LATER);
    expect(reaction.rows.map((row) => row.symbol)).toEqual(['TSM', 'SMH', 'SPY']);
    expect(reaction.rows.map((row) => row.moves[0]!.pct)).toEqual([-1, -1, null]);
    expect(calls).toEqual([
      { symbols: ['TSM', 'SMH', 'SPY'], date: '2024-04-02', until: '2024-04-02T20:00:00.000Z' },
      { symbols: ['TSM', 'SMH', 'SPY'], date: '2024-04-03', until: '2024-04-03T20:00:00.000Z' },
    ]);
  });

  it('deduplicates subjects and asks only for bars at least 15 minutes old', async () => {
    const { market, calls } = fakeMarket({});
    const now = etInstant('2024-04-03', '10:00');
    const reaction = await priceReactionFor(
      market,
      ['SPY', 'TSM', 'TSM', 'SMH'],
      utc('2024-04-03T03:57:09Z'),
      now,
    );
    // Benchmarks always come last, SMH then SPY.
    expect(reaction.rows.map((row) => row.symbol)).toEqual(['TSM', 'SMH', 'SPY']);
    expect(reaction.complete).toBe(false);
    expect(calls[1]!.until).toBe(etInstant('2024-04-03', '09:45').toISOString());
  });

  it('does not ask for a session that has not opened 15 minutes ago', async () => {
    const { market, calls } = fakeMarket({});
    await priceReactionFor(
      market,
      ['TSM'],
      utc('2024-04-03T03:57:09Z'),
      utc('2024-04-03T05:00:00Z'),
    );
    expect(calls.map((call) => call.date)).toEqual(['2024-04-02']);
  });

  it('rejects a future headline and one with no sessions around it', async () => {
    const { market } = fakeMarket({});
    await expect(
      priceReactionFor(market, ['TSM'], utc('2024-04-03T12:00:00Z'), utc('2024-04-03T11:00:00Z')),
    ).rejects.toThrow('in the future');
    await expect(
      priceReactionFor(market, ['TSM'], utc('2020-01-01T12:00:00Z'), LATER),
    ).rejects.toThrow('no market sessions');
  });
});
