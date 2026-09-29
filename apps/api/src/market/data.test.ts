import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type PriceSymbol, etInstant, priceReactionFor } from '@kesher/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type BarsRecording, MissingAlpacaKeysError, barsPath, createMarketData } from './data';

const keys = { keyId: 'key-id', secretKey: 'secret-key' };
const LATER = new Date('2025-06-01T00:00:00Z');

let barsDir: string;
beforeEach(async () => {
  barsDir = await mkdtemp(join(tmpdir(), 'kesher-bars-'));
});
afterEach(async () => {
  await rm(barsDir, { recursive: true, force: true });
});

// Writes synthetic bars to the cache: [ET time, open, close] rows for one symbol and day.
async function cache(symbol: PriceSymbol, date: string, rows: [string, number, number][]) {
  const recording: BarsRecording = {
    provider: 'alpaca',
    feed: 'sip',
    recordedAt: '2026-09-29T00:00:00.000Z',
    symbol,
    date,
    bars: rows.map(([time, o, c]) => ({ t: etInstant(date, time).toISOString(), o, c })),
  };
  const path = barsPath(symbol, date, barsDir);
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, JSON.stringify(recording));
}

// A fetch that fails the test if called, for reads the cache must answer.
const noNetwork = (() => {
  throw new Error('network call');
}) as unknown as typeof globalThis.fetch;

describe('sessions from the committed market calendar', () => {
  it('drops Thanksgiving and keeps the 13:00 early close the day after', async () => {
    const market = createMarketData({ keys: () => undefined, barsDir, fetch: noNetwork });
    const sessions = await market.sessions('2024-11-26', '2024-12-02');
    expect(
      sessions.map((s) => `${s.date} ${s.open.toISOString()} ${s.close.toISOString()}`),
    ).toEqual([
      '2024-11-26 2024-11-26T14:30:00.000Z 2024-11-26T21:00:00.000Z',
      '2024-11-27 2024-11-27T14:30:00.000Z 2024-11-27T21:00:00.000Z',
      '2024-11-29 2024-11-29T14:30:00.000Z 2024-11-29T18:00:00.000Z',
      '2024-12-02 2024-12-02T14:30:00.000Z 2024-12-02T21:00:00.000Z',
    ]);
  });

  it('fetches a year that is not recorded, once', async () => {
    const calendarDir = await mkdtemp(join(tmpdir(), 'kesher-calendar-'));
    let calls = 0;
    const fetch = (() => {
      calls++;
      const days = [{ date: '2031-01-02', open: '09:30', close: '16:00' }];
      return Promise.resolve(new Response(JSON.stringify(days)));
    }) as unknown as typeof globalThis.fetch;
    const market = createMarketData({ keys: () => keys, calendarDir, barsDir, fetch });
    expect((await market.sessions('2031-01-01', '2031-01-31')).map((s) => s.date)).toEqual([
      '2031-01-02',
    ]);
    await market.sessions('2031-01-01', '2031-01-31');
    expect(calls).toBe(1);
    await rm(calendarDir, { recursive: true, force: true });
  });

  it('names the keys when a year is not recorded and they are missing', async () => {
    const calendarDir = await mkdtemp(join(tmpdir(), 'kesher-calendar-'));
    const market = createMarketData({ keys: () => undefined, calendarDir, barsDir });
    await expect(market.sessions('2031-01-01', '2031-01-31')).rejects.toThrow(
      MissingAlpacaKeysError,
    );
    await rm(calendarDir, { recursive: true, force: true });
  });
});

describe('price reaction on the committed calendar', () => {
  // TSM with a base of 100 and a first bar opening at 99; SMH and SPY flat.
  async function anchored(baseDate: string, baseClose: string, tradingDay: string) {
    for (const symbol of ['TSM', 'SMH', 'SPY'] as const) {
      await cache(symbol, baseDate, [[baseClose, 100, 100]]);
      await cache(symbol, tradingDay, [
        ['09:30', symbol === 'TSM' ? 99 : 100, 100],
        ['12:59', 100, 100],
      ]);
    }
  }
  const market = () => createMarketData({ keys: () => undefined, barsDir, fetch: noNetwork });

  it('anchors a weekend headline to Friday close and Monday open', async () => {
    await anchored('2024-04-05', '15:59', '2024-04-08');
    const reaction = await priceReactionFor(
      market(),
      ['TSM'],
      new Date('2024-04-06T15:00:00Z'),
      LATER,
    );
    expect(reaction.anchor).toEqual({
      kind: 'previous_close',
      baseTime: new Date('2024-04-05T20:00:00Z'),
      tradingDay: '2024-04-08',
    });
    expect(reaction.rows[0]!.baseBarTime).toEqual(etInstant('2024-04-05', '15:59'));
    expect(reaction.rows[0]!.moves[0]).toEqual({
      pct: -1,
      barTime: etInstant('2024-04-08', '09:30'),
    });
  });

  it('anchors a Good Friday headline to Thursday close and Monday open', async () => {
    await anchored('2024-03-28', '15:59', '2024-04-01');
    const reaction = await priceReactionFor(
      market(),
      ['TSM'],
      new Date('2024-03-29T15:00:00Z'),
      LATER,
    );
    expect(reaction.anchor.baseTime).toEqual(new Date('2024-03-28T20:00:00Z'));
    expect(reaction.anchor.tradingDay).toBe('2024-04-01');
    expect(reaction.rows[0]!.moves[0]!.pct).toBe(-1);
  });

  it('anchors a headline after the 13:00 early close to that close and the next session', async () => {
    await anchored('2024-11-29', '12:59', '2024-12-02');
    const reaction = await priceReactionFor(
      market(),
      ['TSM'],
      new Date('2024-11-29T18:30:00Z'),
      LATER,
    );
    expect(reaction.anchor).toEqual({
      kind: 'previous_close',
      baseTime: new Date('2024-11-29T18:00:00Z'),
      tradingDay: '2024-12-02',
    });
    expect(reaction.rows[0]!.baseBarTime).toEqual(etInstant('2024-11-29', '12:59'));
    expect(reaction.rows[0]!.moves[0]!.pct).toBe(-1);
  });

  it('caps the windows of a headline before an early close at 13:00', async () => {
    await anchored('2024-11-27', '15:59', '2024-11-29');
    const reaction = await priceReactionFor(
      market(),
      ['TSM'],
      new Date('2024-11-29T17:00:00Z'),
      LATER,
    );
    expect(reaction.anchor.kind).toBe('headline');
    expect(reaction.windows.map((w) => `${w.name} ${w.endsAt.toISOString()}`)).toEqual([
      '15m 2024-11-29T17:15:00.000Z',
      '2h 2024-11-29T18:00:00.000Z',
      'session_close 2024-11-29T18:00:00.000Z',
    ]);
    expect(reaction.complete).toBe(true);
  });
});

describe('bars', () => {
  const session = {
    date: '2024-04-03',
    open: etInstant('2024-04-03', '09:30'),
    close: etInstant('2024-04-03', '16:00'),
  };

  it('reads the cache and keeps only bars closed by until, inside the session', async () => {
    await cache('TSM', '2024-04-03', [
      ['09:30', 1, 1],
      ['09:44', 1, 1],
      ['09:45', 1, 1],
    ]);
    const market = createMarketData({ keys: () => undefined, barsDir, fetch: noNetwork });
    const read = await market.bars(['TSM'], session, etInstant('2024-04-03', '09:45'));
    expect(read.get('TSM')!.map((bar) => bar.t)).toEqual([
      etInstant('2024-04-03', '09:30'),
      etInstant('2024-04-03', '09:44'),
    ]);
  });

  it('fetches what the cache lacks up to until, and keeps a whole session in memory', async () => {
    await cache('TSM', '2024-04-03', [['09:30', 1, 1]]);
    const asked: URL[] = [];
    const fetch = ((input: string) => {
      asked.push(new URL(input));
      const bars = {
        SPY: [
          { t: '2024-04-03T13:29:00Z', o: 1, c: 1 },
          { t: '2024-04-03T13:30:00Z', o: 2, c: 2 },
        ],
      };
      return Promise.resolve(new Response(JSON.stringify({ bars, next_page_token: null })));
    }) as unknown as typeof globalThis.fetch;
    const market = createMarketData({ keys: () => keys, barsDir, fetch });

    const read = await market.bars(['TSM', 'SPY', 'SMH'], session, session.close);
    // The premarket bar is outside the regular session.
    expect(read.get('SPY')).toEqual([{ t: new Date('2024-04-03T13:30:00Z'), o: 2, c: 2 }]);
    expect(read.get('SMH')).toEqual([]);
    expect(read.get('TSM')).toHaveLength(1);
    expect(asked[0]!.searchParams.get('symbols')).toBe('SPY,SMH');
    expect(asked[0]!.searchParams.get('start')).toBe('2024-04-03T13:30:00.000Z');
    // The last bar asked for starts a minute before until.
    expect(asked[0]!.searchParams.get('end')).toBe('2024-04-03T19:59:00.000Z');

    await market.bars(['SPY', 'SMH'], session, session.close);
    expect(asked).toHaveLength(1);
  });

  it('asks again for a session read before its close', async () => {
    let calls = 0;
    const fetch = (() => {
      calls++;
      return Promise.resolve(new Response(JSON.stringify({ bars: {}, next_page_token: null })));
    }) as unknown as typeof globalThis.fetch;
    const market = createMarketData({ keys: () => keys, barsDir, fetch });
    await market.bars(['SPY'], session, etInstant('2024-04-03', '10:00'));
    await market.bars(['SPY'], session, etInstant('2024-04-03', '10:00'));
    expect(calls).toBe(2);
  });

  it('names the keys when the cache lacks a session and they are missing', async () => {
    const market = createMarketData({ keys: () => undefined, barsDir, fetch: noNetwork });
    await expect(market.bars(['SPY'], session, session.close)).rejects.toThrow(
      'ALPACA_API_KEY_ID and ALPACA_API_SECRET_KEY',
    );
  });

  it('rejects a cache file that holds another symbol or day', async () => {
    await cache('TSM', '2024-04-03', [['09:30', 1, 1]]);
    await mkdir(join(barsDir, 'SPY'), { recursive: true });
    const { readFile } = await import('node:fs/promises');
    await writeFile(
      barsPath('SPY', '2024-04-03', barsDir),
      await readFile(barsPath('TSM', '2024-04-03', barsDir), 'utf8'),
    );
    const market = createMarketData({ keys: () => undefined, barsDir, fetch: noNetwork });
    await expect(market.bars(['SPY'], session, session.close)).rejects.toThrow('hold TSM');
  });

  it('never builds a path outside the cache', () => {
    expect(() => barsPath('../x', '2024-04-03', barsDir)).toThrow();
    expect(() => barsPath('TSM', '../../etc', barsDir)).toThrow();
  });
});
