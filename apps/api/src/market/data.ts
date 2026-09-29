import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  type MarketData,
  type MarketSession,
  type MinuteBar,
  PriceSymbol,
  TradingDay,
} from '@kesher/shared';
import { z } from 'zod';
import type { AlpacaKeys } from '../ingest/alpaca';
import { RECORDINGS_DIR } from '../ingest/recordings';
import { CalendarDay, fetchBars, fetchCalendar, toSession } from './alpaca';

// Market data for the price reaction: local files first, Alpaca only for what they lack.
// - recordings/alpaca-calendar/<year>.json: the market calendar, committed (not market data).
// - recordings/alpaca-bars/<SYMBOL>/<YYYY-MM-DD>.json: one symbol's regular session bars for one
//   day. Raw SIP bars are exchange data under Alpaca's terms, so this is a gitignored local cache
//   that npm run record:bars fills (SPEC.md decision log, T13).

export const CALENDAR_DIR = join(RECORDINGS_DIR, 'alpaca-calendar');
export const BARS_DIR = join(RECORDINGS_DIR, 'alpaca-bars');

const MINUTE = 60_000;

export const CalendarRecording = z.strictObject({
  provider: z.literal('alpaca'),
  recordedAt: z.iso.datetime(),
  year: z.int().min(2000).max(2100),
  days: z.array(CalendarDay.strict()),
});
export type CalendarRecording = z.infer<typeof CalendarRecording>;

export const BarsRecording = z.strictObject({
  provider: z.literal('alpaca'),
  feed: z.literal('sip'),
  recordedAt: z.iso.datetime(),
  symbol: PriceSymbol,
  date: TradingDay,
  // The whole regular session, in time order. t is the start of the minute.
  bars: z.array(
    z.strictObject({ t: z.iso.datetime(), o: z.number().positive(), c: z.number().positive() }),
  ),
});
export type BarsRecording = z.infer<typeof BarsRecording>;

// Symbol and date are validated, so a path never steps outside its directory.
export const calendarPath = (year: number, dir = CALENDAR_DIR) =>
  join(dir, `${z.int().min(2000).max(2100).parse(year)}.json`);
export const barsPath = (symbol: string, date: string, dir = BARS_DIR) =>
  join(dir, PriceSymbol.parse(symbol), `${TradingDay.parse(date)}.json`);

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

// null when the year is not recorded. A file that fails its schema, or holds another year, throws.
export async function loadCalendarYear(
  year: number,
  dir = CALENDAR_DIR,
): Promise<CalendarDay[] | null> {
  const json = await readJson(calendarPath(year, dir));
  if (json === null) return null;
  const recording = CalendarRecording.parse(json);
  if (recording.year !== year) throw new Error(`calendar ${year} holds ${recording.year}`);
  return recording.days;
}

// null when the session is not in the cache.
export async function loadSessionBars(
  symbol: PriceSymbol,
  date: string,
  dir = BARS_DIR,
): Promise<MinuteBar[] | null> {
  const json = await readJson(barsPath(symbol, date, dir));
  if (json === null) return null;
  const recording = BarsRecording.parse(json);
  if (recording.symbol !== symbol || recording.date !== date) {
    throw new Error(`bars ${symbol} ${date} hold ${recording.symbol} ${recording.date}`);
  }
  return recording.bars.map((bar) => ({ t: new Date(bar.t), o: bar.o, c: bar.c }));
}

export class MissingAlpacaKeysError extends Error {
  override name = 'MissingAlpacaKeysError';
  constructor() {
    super('ALPACA_API_KEY_ID and ALPACA_API_SECRET_KEY are needed for market data not cached');
  }
}

export interface MarketDataOptions {
  // Read on the first call that needs Alpaca; undefined when the keys are not set.
  keys: () => AlpacaKeys | undefined;
  calendarDir?: string;
  barsDir?: string;
  fetch?: typeof globalThis.fetch;
}

const years = (from: string, to: string) => {
  const first = Number(from.slice(0, 4));
  const last = Number(to.slice(0, 4));
  return Array.from({ length: Math.max(0, last - first + 1) }, (_, index) => first + index);
};

export const inSession = (session: MarketSession) => (bar: MinuteBar) =>
  bar.t.getTime() >= session.open.getTime() && bar.t.getTime() < session.close.getTime();

export function createMarketData({
  keys,
  calendarDir = CALENDAR_DIR,
  barsDir = BARS_DIR,
  fetch,
}: MarketDataOptions): MarketData {
  const alpaca = () => {
    const found = keys();
    if (!found) throw new MissingAlpacaKeysError();
    return { keys: found, fetch };
  };

  // Calendar years and whole sessions fetched from Alpaca, kept for the life of the process.
  const calendarYears = new Map<number, Promise<CalendarDay[]>>();
  const fullSessions = new Map<string, MinuteBar[]>();

  const calendarYear = (year: number) => {
    let days = calendarYears.get(year);
    if (!days) {
      days = loadCalendarYear(year, calendarDir).then(
        (recorded) => recorded ?? fetchCalendar(`${year}-01-01`, `${year}-12-31`, alpaca()),
      );
      // A failed read is not kept, so the next call tries again.
      days.catch(() => calendarYears.delete(year));
      calendarYears.set(year, days);
    }
    return days;
  };

  return {
    async sessions(from, to) {
      const days = (await Promise.all(years(from, to).map(calendarYear))).flat();
      return days
        .filter((day) => day.date >= from && day.date <= to)
        .map(toSession)
        .sort((a, b) => a.open.getTime() - b.open.getTime());
    },

    async bars(symbols, session, until) {
      const closedBy = (bar: MinuteBar) => bar.t.getTime() + MINUTE <= until.getTime();
      const result = new Map<PriceSymbol, MinuteBar[]>();
      const missing: PriceSymbol[] = [];
      for (const symbol of symbols) {
        const key = `${symbol} ${session.date}`;
        const known =
          fullSessions.get(key) ?? (await loadSessionBars(symbol, session.date, barsDir));
        if (known) result.set(symbol, known.filter(inSession(session)).filter(closedBy));
        else missing.push(symbol);
      }
      if (missing.length > 0) {
        // Alpaca's end is inclusive on the bar start: the last bar asked for closes at until.
        const fetched = await fetchBars(
          missing,
          session.open,
          new Date(until.getTime() - MINUTE),
          alpaca(),
        );
        const whole = until.getTime() >= session.close.getTime();
        for (const symbol of missing) {
          const regular = (fetched.get(symbol) ?? []).filter(inSession(session)).filter(closedBy);
          if (whole) fullSessions.set(`${symbol} ${session.date}`, regular);
          result.set(symbol, regular);
        }
      }
      return result;
    },
  };
}
