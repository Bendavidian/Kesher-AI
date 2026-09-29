import { type MarketSession, type MinuteBar, PriceSymbol, etInstant } from '@kesher/shared';
import { z } from 'zod';
import type { AlpacaKeys } from '../ingest/alpaca';

// Alpaca market data on the free plan: the market calendar and SIP minute bars (SPEC.md, Price
// reaction). Bars are only served once they are 15 minutes old; callers never ask for newer ones.

export const ALPACA_CALENDAR_URL = 'https://paper-api.alpaca.markets/v2/calendar';
export const ALPACA_BARS_URL = 'https://data.alpaca.markets/v2/stocks/bars';
const MAX_PAGES = 20;
// A request that hangs fails instead, so a feed that waits for a card never stalls on Alpaca.
export const FETCH_TIMEOUT_MS = 10_000;

const headers = (keys: AlpacaKeys) => ({
  'APCA-API-KEY-ID': keys.keyId,
  'APCA-API-SECRET-KEY': keys.secretKey,
});

// One trading day as the calendar sends it: ET date and ET wall clock open and close. Weekends
// and holidays are absent; early closes have an earlier close.
export const CalendarDay = z.object({
  date: z.iso.date(),
  open: z.string().regex(/^\d{2}:\d{2}$/),
  close: z.string().regex(/^\d{2}:\d{2}$/),
});
export type CalendarDay = z.infer<typeof CalendarDay>;

export const toSession = (day: CalendarDay): MarketSession => ({
  date: day.date,
  open: etInstant(day.date, day.open),
  close: etInstant(day.date, day.close),
});

export interface FetchOptions {
  keys: AlpacaKeys;
  fetch?: typeof globalThis.fetch;
}

// Trading days between two ET dates, inclusive, with only the fields the reaction reads.
export async function fetchCalendar(
  from: string,
  to: string,
  { keys, fetch = globalThis.fetch }: FetchOptions,
): Promise<CalendarDay[]> {
  const query = new URLSearchParams({ start: from, end: to });
  const response = await fetch(`${ALPACA_CALENDAR_URL}?${query.toString()}`, {
    headers: headers(keys),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Alpaca calendar answered ${response.status}`);
  return z
    .array(CalendarDay)
    .parse(await response.json())
    .map(({ date, open, close }) => ({ date, open, close }));
}

const RawBar = z.object({
  t: z.iso.datetime(),
  o: z.number().positive(),
  c: z.number().positive(),
});

const BarsPage = z.object({
  bars: z.record(z.string(), z.array(RawBar)).nullable(),
  next_page_token: z.string().nullish(),
});

// Raw SIP minute bars for the symbols, starting at or after start and at or before end, in time
// order. Every symbol asked for is in the map, with an empty list when it had no trades.
export async function fetchBars(
  symbols: readonly PriceSymbol[],
  start: Date,
  end: Date,
  { keys, fetch = globalThis.fetch }: FetchOptions,
): Promise<Map<PriceSymbol, MinuteBar[]>> {
  const bars = new Map<PriceSymbol, MinuteBar[]>(symbols.map((symbol) => [symbol, []]));
  let pageToken: string | null | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const query = new URLSearchParams({
      symbols: symbols.join(','),
      timeframe: '1Min',
      start: start.toISOString(),
      end: end.toISOString(),
      limit: '10000',
      feed: 'sip',
      adjustment: 'raw',
      sort: 'asc',
    });
    if (pageToken) query.set('page_token', pageToken);
    const response = await fetch(`${ALPACA_BARS_URL}?${query.toString()}`, {
      headers: headers(keys),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`Alpaca bars answered ${response.status}`);
    const body = BarsPage.parse(await response.json());
    for (const [symbol, list] of Object.entries(body.bars ?? {})) {
      const known = PriceSymbol.safeParse(symbol);
      const into = known.success ? bars.get(known.data) : undefined;
      // A symbol not asked for is ignored.
      if (!into) continue;
      into.push(...list.map((bar) => ({ t: new Date(bar.t), o: bar.o, c: bar.c })));
    }
    pageToken = body.next_page_token;
    if (!pageToken) return bars;
  }
  throw new Error(`Alpaca bars needed more than ${MAX_PAGES} pages`);
}
