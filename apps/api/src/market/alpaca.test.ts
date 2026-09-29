import { describe, expect, it } from 'vitest';
import {
  ALPACA_BARS_URL,
  ALPACA_CALENDAR_URL,
  fetchBars,
  fetchCalendar,
  toSession,
} from './alpaca';

const keys = { keyId: 'key-id', secretKey: 'secret-key' };

// A fetch that answers from a queue and records every URL and header it was given.
function fakeFetch(bodies: unknown[], status = 200) {
  const calls: { url: URL; headers: Record<string, string>; signal?: AbortSignal }[] = [];
  // The code under test always passes a string URL and a headers object.
  const fetch = (
    input: string,
    init?: { headers: Record<string, string>; signal?: AbortSignal },
  ) => {
    calls.push({ url: new URL(input), headers: init?.headers ?? {}, signal: init?.signal });
    return Promise.resolve(new Response(JSON.stringify(bodies.shift()), { status }));
  };
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls };
}

describe('fetchCalendar', () => {
  it('asks for the date range and keeps date, open and close', async () => {
    const { fetch, calls } = fakeFetch([
      [
        {
          date: '2024-11-29',
          open: '09:30',
          close: '13:00',
          session_open: '0400',
          session_close: '2000',
          settlement_date: '2024-12-03',
        },
      ],
    ]);
    const days = await fetchCalendar('2024-01-01', '2024-12-31', { keys, fetch });
    expect(days).toEqual([{ date: '2024-11-29', open: '09:30', close: '13:00' }]);
    expect(`${calls[0]!.url.origin}${calls[0]!.url.pathname}`).toBe(ALPACA_CALENDAR_URL);
    expect(calls[0]!.url.searchParams.get('start')).toBe('2024-01-01');
    expect(calls[0]!.url.searchParams.get('end')).toBe('2024-12-31');
    expect(calls[0]!.headers['APCA-API-KEY-ID']).toBe('key-id');
  });

  it('turns a calendar day into ET instants, early close included', () => {
    const session = toSession({ date: '2024-11-29', open: '09:30', close: '13:00' });
    expect(session.open.toISOString()).toBe('2024-11-29T14:30:00.000Z');
    expect(session.close.toISOString()).toBe('2024-11-29T18:00:00.000Z');
  });

  it('passes a timeout signal to every request, so a hung one fails', async () => {
    const { fetch, calls } = fakeFetch([[], { bars: {}, next_page_token: null }]);
    await fetchCalendar('2024-01-01', '2024-01-31', { keys, fetch });
    await fetchBars(['TSM'], new Date(0), new Date(60_000), { keys, fetch });
    expect(calls.map((call) => call.signal instanceof AbortSignal)).toEqual([true, true]);
  });

  it('fails on an error status', async () => {
    const { fetch } = fakeFetch([{ message: 'forbidden' }], 403);
    await expect(fetchCalendar('2024-01-01', '2024-01-31', { keys, fetch })).rejects.toThrow(
      'Alpaca calendar answered 403',
    );
  });
});

describe('fetchBars', () => {
  const start = new Date('2024-04-03T13:30:00Z');
  const end = new Date('2024-04-03T19:59:00Z');

  it('asks for SIP minute bars and follows the page token', async () => {
    const { fetch, calls } = fakeFetch([
      {
        bars: { TSM: [{ t: '2024-04-03T13:30:00Z', o: 138.58, h: 139, l: 138, c: 138.9, v: 1 }] },
        next_page_token: 'page-2',
      },
      {
        bars: {
          TSM: [{ t: '2024-04-03T13:31:00Z', o: 138.9, c: 139.1 }],
          SPY: [{ t: '2024-04-03T13:30:00Z', o: 517.7, c: 518 }],
          QQQ: [{ t: '2024-04-03T13:30:00Z', o: 440, c: 441 }],
        },
        next_page_token: null,
      },
    ]);
    const bars = await fetchBars(['TSM', 'SPY', 'SMH'], start, end, { keys, fetch });
    expect(bars.get('TSM')).toEqual([
      { t: new Date('2024-04-03T13:30:00Z'), o: 138.58, c: 138.9 },
      { t: new Date('2024-04-03T13:31:00Z'), o: 138.9, c: 139.1 },
    ]);
    expect(bars.get('SPY')).toHaveLength(1);
    // Asked for but without trades: an empty list. Not asked for: ignored.
    expect(bars.get('SMH')).toEqual([]);
    expect([...bars.keys()]).toEqual(['TSM', 'SPY', 'SMH']);

    const first = calls[0]!.url;
    expect(`${first.origin}${first.pathname}`).toBe(ALPACA_BARS_URL);
    expect(Object.fromEntries(first.searchParams)).toEqual({
      symbols: 'TSM,SPY,SMH',
      timeframe: '1Min',
      start: '2024-04-03T13:30:00.000Z',
      end: '2024-04-03T19:59:00.000Z',
      limit: '10000',
      feed: 'sip',
      adjustment: 'raw',
      sort: 'asc',
    });
    expect(calls[1]!.url.searchParams.get('page_token')).toBe('page-2');
  });

  it('accepts a page with no bars', async () => {
    const { fetch } = fakeFetch([{ bars: null, next_page_token: null }]);
    const bars = await fetchBars(['TSM'], start, end, { keys, fetch });
    expect(bars.get('TSM')).toEqual([]);
  });

  it('fails on an error status', async () => {
    const { fetch } = fakeFetch([{ message: 'subscription does not permit' }], 403);
    await expect(fetchBars(['TSM'], start, end, { keys, fetch })).rejects.toThrow(
      'Alpaca bars answered 403',
    );
  });
});
