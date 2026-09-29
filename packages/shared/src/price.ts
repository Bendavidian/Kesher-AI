import { z } from 'zod';
import { BENCHMARKS, UNIVERSE } from './domain/universe';

// The price reaction from SPEC.md, Price reaction, and docs/INTERFACES.md, get_price_reaction.
// Code only: the moves are temporal association next to the benchmarks, never a cause. The MCP
// tool and FeedCard.priceReaction both come from priceReactionFor, behind the MarketData interface,
// so this file does no I/O and runs in the browser too.

// The free Alpaca plan serves SIP bars only once they are 15 minutes old.
export const DELAY_MINUTES = 15;
const MINUTE = 60_000;
const DELAY_MS = DELAY_MINUTES * MINUTE;

// Universe companies and the two benchmarks.
export const PriceSymbol = z.enum([...UNIVERSE, ...BENCHMARKS]);
export type PriceSymbol = z.infer<typeof PriceSymbol>;
// Every reaction shows these after its subjects, in this order.
export const REACTION_BENCHMARKS = ['SMH', 'SPY'] as const satisfies readonly PriceSymbol[];

// An ET calendar date.
export const TradingDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

// One regular session from the Alpaca market calendar. Early closes have an earlier close.
export const MarketSession = z.strictObject({ date: TradingDay, open: z.date(), close: z.date() });
export type MarketSession = z.infer<typeof MarketSession>;

// A one minute SIP bar: t is the start of the minute, o and c the first and last trade in it.
export const MinuteBar = z.strictObject({
  t: z.date(),
  o: z.number().positive(),
  c: z.number().positive(),
});
export type MinuteBar = z.infer<typeof MinuteBar>;

export const PRICE_WINDOWS = ['open_gap', '15m', '2h', 'session_close'] as const;
export const PriceWindowName = z.enum(PRICE_WINDOWS);
export type PriceWindowName = z.infer<typeof PriceWindowName>;

export const PriceAnchor = z.strictObject({
  // headline: the headline fell inside a regular session. previous_close: anything else.
  kind: z.enum(['headline', 'previous_close']),
  // The headline time, or the previous session's close.
  baseTime: z.date(),
  // The ET date of the session the windows fall in.
  tradingDay: TradingDay,
});
export type PriceAnchor = z.infer<typeof PriceAnchor>;

export const PriceWindow = z.strictObject({ name: PriceWindowName, endsAt: z.date() });
export type PriceWindow = z.infer<typeof PriceWindow>;

// null while the window is under 15 minutes old, or when no bar falls in it. Both or neither.
export const PriceMove = z
  .strictObject({
    pct: z.number().nullable(),
    barTime: z.date().nullable(),
  })
  .refine((move) => (move.pct === null) === (move.barTime === null), {
    error: 'pct and barTime are null together',
  });
export type PriceMove = z.infer<typeof PriceMove>;

export const PriceRow = z.strictObject({
  symbol: PriceSymbol,
  // The close of the base bar and that bar's start; null without a base bar, or while the base
  // is under 15 minutes old.
  basePrice: z.number().positive().nullable(),
  baseBarTime: z.date().nullable(),
  // One per window, in window order.
  moves: z.array(PriceMove).min(1).max(PRICE_WINDOWS.length),
});
export type PriceRow = z.infer<typeof PriceRow>;

export const PriceReaction = z
  .strictObject({
    anchor: PriceAnchor,
    windows: z.array(PriceWindow).min(1).max(PRICE_WINDOWS.length),
    rows: z.array(PriceRow).min(1),
    // SIP data, delayed 15 minutes. Always true.
    delayed: z.literal(true),
    // Every window is at least 15 minutes old, so the result can no longer change.
    complete: z.boolean(),
  })
  .refine(
    (reaction) => reaction.rows.every((row) => row.moves.length === reaction.windows.length),
    {
      error: 'every row has one move per window',
      path: ['rows'],
    },
  );
export type PriceReaction = z.infer<typeof PriceReaction>;

// Market data the reaction reads. The api implements it over Alpaca and the local bar cache.
export interface MarketData {
  // Regular sessions whose ET date lies between from and to, inclusive, in time order.
  sessions(from: string, to: string): Promise<MarketSession[]>;
  // Each symbol's regular session bars in one session that closed by until (t + 1 minute <= until),
  // in time order. A symbol with no bars maps to an empty list.
  bars(
    symbols: readonly PriceSymbol[],
    session: MarketSession,
    until: Date,
  ): Promise<Map<PriceSymbol, MinuteBar[]>>;
}

// ET wall clock ------------------------------------------------------------------------------------

const etParts = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

function wallClock(instant: Date) {
  const parts = Object.fromEntries(etParts.formatToParts(instant).map((p) => [p.type, p.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    asUtc: Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
    ),
  };
}

// The ET date of an instant.
export const etDate = (instant: Date): string => wallClock(instant).date;

// The instant of an ET date and time (HH:MM), as the Alpaca market calendar gives them.
export function etInstant(date: string, time: string): Date {
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number);
  const [hour = 0, minute = 0] = time.split(':').map(Number);
  const asUtc = Date.UTC(year, month - 1, day, hour, minute);
  // ET is UTC minus the offset at that instant; a second pass settles a daylight saving change.
  let instant = asUtc;
  for (let pass = 0; pass < 2; pass++) {
    const whole = Math.floor(instant / MINUTE) * MINUTE;
    instant = asUtc - (wallClock(new Date(whole)).asUtc - whole);
  }
  return new Date(instant);
}

// Anchor --------------------------------------------------------------------------------------------

export interface ResolvedAnchor {
  anchor: PriceAnchor;
  windows: PriceWindow[];
  // The session the windows fall in, and the one the base bar comes from.
  session: MarketSession;
  baseSession: MarketSession;
}

// Anchors a headline to the regular session (T00 finding A). Inside a session [open, close) the
// base is the headline; otherwise it is the previous close and the windows fall in the next
// session. null without a session on both sides.
export function resolveAnchor(
  sessions: readonly MarketSession[],
  headline: Date,
): ResolvedAnchor | null {
  const t = headline.getTime();
  const capped = (session: MarketSession, at: number) =>
    new Date(Math.min(at, session.close.getTime()));

  const inside = sessions.find((s) => s.open.getTime() <= t && t < s.close.getTime());
  if (inside) {
    return {
      anchor: { kind: 'headline', baseTime: headline, tradingDay: inside.date },
      windows: [
        { name: '15m', endsAt: capped(inside, t + 15 * MINUTE) },
        { name: '2h', endsAt: capped(inside, t + 120 * MINUTE) },
        { name: 'session_close', endsAt: inside.close },
      ],
      session: inside,
      baseSession: inside,
    };
  }

  const previous = sessions.findLast((s) => s.close.getTime() <= t);
  const next = sessions.find((s) => s.open.getTime() > t);
  if (!previous || !next) return null;
  const open = next.open.getTime();
  return {
    anchor: { kind: 'previous_close', baseTime: previous.close, tradingDay: next.date },
    windows: [
      { name: 'open_gap', endsAt: next.open },
      { name: '15m', endsAt: capped(next, open + 15 * MINUTE) },
      { name: '2h', endsAt: capped(next, open + 120 * MINUTE) },
      { name: 'session_close', endsAt: next.close },
    ],
    session: next,
    baseSession: previous,
  };
}

// Computation ---------------------------------------------------------------------------------------

// Percent change rounded to 2 decimals, as docs/SPIKE.md check 3; never negative zero.
const percent = (price: number, base: number) =>
  Number((((price - base) / base) * 100).toFixed(2)) || 0;

const inSession = (session: MarketSession) => (bar: MinuteBar) =>
  bar.t.getTime() >= session.open.getTime() && bar.t.getTime() < session.close.getTime();

export interface ReactionInput extends ResolvedAnchor {
  symbols: readonly PriceSymbol[];
  bars: ReadonlyMap<PriceSymbol, readonly MinuteBar[]>;
  now: Date;
}

// The reaction from bars already read. Only bars that closed at least 15 minutes before now count.
// A window is ready once the bar it reads could have closed that long ago: the bar starting at
// endsAt closes a minute later, or at the session close. The base is used only once it is final.
export function computeReaction({
  anchor,
  windows,
  session,
  baseSession,
  symbols,
  bars,
  now,
}: ReactionInput): PriceReaction {
  const cutoff = now.getTime() - DELAY_MS;
  const settled = (bar: MinuteBar) => bar.t.getTime() + MINUTE <= cutoff;
  // The last bar a window reads starts at endsAt at the latest and ends by the close.
  const ready = (window: PriceWindow) =>
    Math.min(window.endsAt.getTime() + MINUTE, session.close.getTime()) <= cutoff;
  const headline = anchor.kind === 'headline';
  // The bar at the headline, or the previous session's last bar, can no longer change.
  const baseFinal = headline
    ? Math.floor(anchor.baseTime.getTime() / MINUTE) * MINUTE + MINUTE <= cutoff
    : baseSession.close.getTime() <= cutoff;

  const rows = symbols.map((symbol): PriceRow => {
    const all = [...(bars.get(symbol) ?? [])]
      .filter(settled)
      .sort((a, b) => a.t.getTime() - b.t.getTime());
    const today = all.filter(inSession(session));
    const baseBar = !baseFinal
      ? undefined
      : headline
        ? today.findLast((bar) => bar.t.getTime() <= anchor.baseTime.getTime())
        : all.filter(inSession(baseSession)).at(-1);
    // Headline windows read from the base bar on, so a quiet window repeats the base (0.00);
    // the others read the trading day from the open.
    const after = headline
      ? today.filter((bar) => baseBar !== undefined && bar.t.getTime() >= baseBar.t.getTime())
      : today;

    const moves = windows.map((window): PriceMove => {
      if (!baseBar || !ready(window)) return { pct: null, barTime: null };
      if (window.name === 'open_gap') {
        const first = after[0];
        return first
          ? { pct: percent(first.o, baseBar.c), barTime: first.t }
          : { pct: null, barTime: null };
      }
      const bar = after.findLast((b) => b.t.getTime() <= window.endsAt.getTime());
      return bar
        ? { pct: percent(bar.c, baseBar.c), barTime: bar.t }
        : { pct: null, barTime: null };
    });

    return {
      symbol,
      basePrice: baseBar?.c ?? null,
      baseBarTime: baseBar?.t ?? null,
      moves,
    };
  });

  return { anchor, windows, rows, delayed: true, complete: windows.every(ready) };
}

export class PriceReactionError extends Error {
  override name = 'PriceReactionError';
}

// Holidays and weekends never span more than a few days, so ten on each side always holds the
// previous and the next session.
const CALENDAR_SPAN_MS = 10 * 24 * 60 * MINUTE;

// The reaction of the subjects, then SMH and SPY, to a headline. The one function behind
// get_price_reaction and FeedCard.priceReaction.
export async function priceReactionFor(
  market: MarketData,
  subjects: readonly PriceSymbol[],
  headline: Date,
  now: Date,
): Promise<PriceReaction> {
  if (headline.getTime() > now.getTime()) {
    throw new PriceReactionError('the headline time is in the future');
  }
  const sessions = await market.sessions(
    etDate(new Date(headline.getTime() - CALENDAR_SPAN_MS)),
    etDate(new Date(headline.getTime() + CALENDAR_SPAN_MS)),
  );
  const resolved = resolveAnchor(sessions, headline);
  if (!resolved) throw new PriceReactionError('no market sessions around the headline time');

  // Subjects first, then SMH and SPY, whatever the subjects hold.
  const benchmarks: readonly PriceSymbol[] = REACTION_BENCHMARKS;
  const symbols = [
    ...new Set(subjects.filter((symbol) => !benchmarks.includes(symbol))),
    ...REACTION_BENCHMARKS,
  ];
  const cutoff = now.getTime() - DELAY_MS;
  const bars = new Map<PriceSymbol, MinuteBar[]>(symbols.map((symbol) => [symbol, []]));
  const distinct = [resolved.baseSession, resolved.session].filter(
    (session, index, list) => list.indexOf(session) === index,
  );
  for (const session of distinct) {
    // A session with no bar closed 15 minutes ago has nothing to read yet.
    if (session.open.getTime() + MINUTE > cutoff) continue;
    const until = new Date(Math.min(session.close.getTime(), cutoff));
    const read = await market.bars(symbols, session, until);
    for (const symbol of symbols) bars.get(symbol)!.push(...(read.get(symbol) ?? []));
  }
  return computeReaction({ ...resolved, symbols, bars, now });
}
