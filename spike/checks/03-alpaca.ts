// Alpaca: the historical TSM item for the demo event, SIP bars around it, and live news over WebSocket.
import { http, pickHeaders, type Check, type Ctx } from '../lib.ts';

interface NewsItem {
  id: number;
  headline: string;
  summary: string;
  author: string;
  created_at: string;
  url: string;
  symbols: string[];
  source: string;
}

interface Bar {
  t: string;
  o: number;
  c: number;
  v: number;
}

// Primary: the planned demo event, the Taiwan earthquake of 3 Apr 2024 (local time).
// Fallback: TSMC's Q2 2026 results in July 2026.
const WINDOWS = [
  { label: 'Taiwan earthquake, Apr 2024', start: '2024-04-02T00:00:00Z', end: '2024-04-05T00:00:00Z', match: /earthquake|quake|tremor/i },
  { label: 'TSMC Q2 2026 results, Jul 2026 (fallback)', start: '2026-07-14T00:00:00Z', end: '2026-07-19T00:00:00Z', match: /TSMC|Taiwan Semiconductor/i },
];

const BAR_SYMBOLS = ['TSM', 'NVDA', 'SMH', 'SPY'];
const REACTION_WINDOWS = [
  { label: '15m', ms: 15 * 60_000 },
  { label: '2h', ms: 2 * 3_600_000 },
  { label: '1d', ms: 24 * 3_600_000 },
];

function authHeaders(ctx: Ctx) {
  return {
    'APCA-API-KEY-ID': ctx.env('ALPACA_API_KEY_ID')!,
    'APCA-API-SECRET-KEY': ctx.env('ALPACA_API_SECRET_KEY')!,
  };
}

async function findItem(ctx: Ctx) {
  const headers = authHeaders(ctx);
  const tried: unknown[] = [];
  for (const w of WINDOWS) {
    const items: NewsItem[] = [];
    let pageToken: string | undefined;
    let ms = 0;
    do {
      const qs = new URLSearchParams({ symbols: 'TSM', start: w.start, end: w.end, limit: '50', sort: 'asc' });
      if (pageToken) qs.set('page_token', pageToken);
      const res = await http<any>(`https://data.alpaca.markets/v1beta1/news?${qs}`, { headers });
      ms += res.ms;
      items.push(...res.body.news);
      pageToken = res.body.next_page_token ?? undefined;
    } while (pageToken && items.length < 500);
    // Earliest match that names TSMC in the headline, else the earliest match.
    const matches = items.filter((n) => w.match.test(n.headline));
    const namesTsmc = matches.filter((n) => /\bTSMC\b|Taiwan Semi/i.test(n.headline));
    ctx.log(`${w.label}: ${items.length} TSM items, ${matches.length} matching, ${namesTsmc.length} naming TSMC`);
    tried.push({
      window: w.label, start: w.start, end: w.end, tsmItems: items.length, ms,
      matching: matches.map((n) => ({ id: n.id, created_at: n.created_at, headline: n.headline })),
    });
    const pick = namesTsmc[0] ?? matches[0];
    if (pick) return { item: pick, window: w.label, fallback: w !== WINDOWS[0], matching: matches.length, tried };
  }
  return { item: undefined, tried };
}

async function fetchBars(ctx: Ctx, eventTime: Date) {
  const headers = authHeaders(ctx);
  // From a day before, so the previous regular session close is included.
  const start = new Date(eventTime.getTime() - 24 * 3_600_000).toISOString();
  const end = new Date(eventTime.getTime() + 30 * 3_600_000).toISOString();
  const bars: Record<string, Bar[]> = Object.fromEntries(BAR_SYMBOLS.map((s) => [s, []]));
  let pageToken: string | undefined;
  let ms = 0;
  let pages = 0;
  let rateLimit: Record<string, string> = {};
  do {
    const qs = new URLSearchParams({
      symbols: BAR_SYMBOLS.join(','),
      timeframe: '1Min',
      start,
      end,
      limit: '10000',
      feed: 'sip',
      adjustment: 'raw',
      sort: 'asc',
    });
    if (pageToken) qs.set('page_token', pageToken);
    const res = await http<any>(`https://data.alpaca.markets/v2/stocks/bars?${qs}`, { headers });
    ms += res.ms;
    pages++;
    rateLimit = pickHeaders(res.headers, 'x-ratelimit');
    for (const [sym, list] of Object.entries(res.body.bars ?? {})) bars[sym].push(...(list as Bar[]));
    pageToken = res.body.next_page_token ?? undefined;
  } while (pageToken);
  return { bars, start, end, ms, pages, rateLimit };
}

// Price reaction as a feasibility check only: temporal association, never causation.
function reaction(bars: Bar[], eventTime: Date) {
  if (!bars.length) return { bars: 0 };
  const t0 = eventTime.getTime();
  const at = (t: number) => [...bars].reverse().find((b) => Date.parse(b.t) <= t);
  const ref = at(t0) ?? bars[0];
  const windows: Record<string, unknown> = {};
  for (const w of REACTION_WINDOWS) {
    const b = at(t0 + w.ms);
    if (!b) continue;
    const staleMin = Math.round((t0 + w.ms - Date.parse(b.t)) / 60_000);
    windows[w.label] = {
      pct: Number((((b.c - ref.c) / ref.c) * 100).toFixed(2)),
      priceAt: b.t,
      minutesSinceLastBar: staleMin,
    };
  }
  return { bars: bars.length, first: bars[0].t, last: bars[bars.length - 1].t, refClose: ref.c, refTime: ref.t, windows };
}

// Trading days from the Alpaca market calendar: date (ET) -> session open and close in minutes since midnight ET.
// Weekends and holidays are absent; early close days have an earlier close.
type Calendar = Map<string, { open: number; close: number }>;

async function fetchCalendar(ctx: Ctx, eventTime: Date) {
  const day = 24 * 3_600_000;
  const start = new Date(eventTime.getTime() - 7 * day).toISOString().slice(0, 10);
  const end = new Date(eventTime.getTime() + 7 * day).toISOString().slice(0, 10);
  const res = await http<{ date: string; open: string; close: string }[]>(
    `https://paper-api.alpaca.markets/v2/calendar?start=${start}&end=${end}`,
    { headers: authHeaders(ctx) },
  );
  const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
  const calendar: Calendar = new Map(res.body.map((d) => [d.date, { open: toMin(d.open), close: toMin(d.close) }]));
  return { calendar, days: res.body, ms: res.ms, start, end };
}

const etFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
});
function et(ms: number) {
  const p = Object.fromEntries(etFormat.formatToParts(ms).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: (Number(p.hour) % 24) * 60 + Number(p.minute) };
}
function isRegular(calendar: Calendar, ms: number) {
  const { date, minutes } = et(ms);
  const session = calendar.get(date);
  return !!session && minutes >= session.open && minutes < session.close;
}

// Anchored to the regular session: base is the price at the headline if the market is open,
// otherwise the last regular close before it. Windows are then measured from the first regular bar.
function sessionReaction(bars: Bar[], eventTime: Date, calendar: Calendar) {
  const t0 = eventTime.getTime();
  const regular = bars.filter((b) => isRegular(calendar, Date.parse(b.t)));
  const during = isRegular(calendar, t0);
  const before = regular.filter((b) => Date.parse(b.t) <= t0);
  const after = regular.filter((b) => Date.parse(b.t) >= t0);
  if (!before.length || !after.length) return { error: 'No regular session bars on one side of the headline' };
  const base = before[before.length - 1];
  const open = after[0];
  const anchor = during ? t0 : Date.parse(open.t);
  const pct = (p: number) => Number((((p - base.c) / base.c) * 100).toFixed(2));
  const at = (t: number) => [...after].reverse().find((b) => Date.parse(b.t) <= t);
  const tradingDay = et(Date.parse(open.t)).date;
  const sessionClose = after.filter((b) => et(Date.parse(b.t)).date === tradingDay).at(-1)!;
  const w15 = at(anchor + 15 * 60_000);
  const w2h = at(anchor + 2 * 3_600_000);
  return {
    headlineDuringSession: during,
    tradingDay,
    base: { time: base.t, price: base.c, kind: during ? 'price at headline' : 'previous regular close' },
    firstRegularBar: open.t,
    windows: {
      openGap: during ? null : { pct: Number((((open.o - base.c) / base.c) * 100).toFixed(2)), at: open.t },
      '15m': w15 && { pct: pct(w15.c), at: w15.t },
      '2h': w2h && { pct: pct(w2h.c), at: w2h.t },
      sessionClose: { pct: pct(sessionClose.c), at: sessionClose.t },
    },
  };
}

function liveNews(ctx: Ctx, waitMs: number) {
  return new Promise<Record<string, unknown>>((resolve) => {
    const started = performance.now();
    const elapsed = () => Math.round(performance.now() - started);
    const result: Record<string, unknown> = { waitMs, connected: false, authenticated: false, subscribed: false, item: null };
    const ws = new WebSocket('wss://stream.data.alpaca.markets/v1beta1/news');
    const finish = () => {
      clearTimeout(timer);
      result.totalMs = elapsed();
      try {
        ws.close();
      } catch {
        // Already closed.
      }
      resolve(result);
    };
    const timer = setTimeout(() => {
      ctx.log(`no live item within ${Math.round(waitMs / 60_000)} min`);
      finish();
    }, waitMs);
    ws.onmessage = (event) => {
      for (const msg of JSON.parse(String(event.data)) as any[]) {
        if (msg.T === 'success' && msg.msg === 'connected') {
          result.connected = true;
          result.connectedMs = elapsed();
          ws.send(
            JSON.stringify({ action: 'auth', key: ctx.env('ALPACA_API_KEY_ID'), secret: ctx.env('ALPACA_API_SECRET_KEY') }),
          );
        } else if (msg.T === 'success' && msg.msg === 'authenticated') {
          result.authenticated = true;
          ws.send(JSON.stringify({ action: 'subscribe', news: ['*'] }));
        } else if (msg.T === 'subscription') {
          result.subscribed = true;
          ctx.log(`subscribed to live news, waiting up to ${Math.round(waitMs / 60_000)} min for an item`);
        } else if (msg.T === 'error') {
          result.error = `${msg.code}: ${msg.msg}`;
          finish();
        } else if (msg.T === 'n') {
          result.item = { headline: msg.headline, symbols: msg.symbols, created_at: msg.created_at, source: msg.source };
          result.receivedAfterMs = elapsed();
          ctx.log(`live item received after ${Math.round(elapsed() / 1000)} s`);
          finish();
        }
      }
    };
    ws.onerror = () => {
      result.error = result.error ?? 'WebSocket error';
      finish();
    };
  });
}

const check: Check = {
  name: 'alpaca',
  title: 'Alpaca: demo news item, SIP bars and live news',
  keys: ['ALPACA_API_KEY_ID', 'ALPACA_API_SECRET_KEY'],
  async run(ctx) {
    const limits = [
      'Free plan: SIP bars only when the window ends more than 15 minutes ago.',
      'Free plan: one concurrent market data WebSocket connection.',
    ];
    const found = await findItem(ctx);
    if (!found.item) {
      return { status: 'fail', reason: 'No TSM item in either window', evidence: { windowsTried: found.tried }, limits };
    }
    const item = found.item;
    const record = {
      id: item.id,
      headline: item.headline,
      summary: item.summary,
      created_at: item.created_at,
      url: item.url,
      symbols: item.symbols,
      source: item.source,
      window: found.window,
    };
    ctx.writeOutput('tsmc-item', record);
    ctx.log(`item ${item.id} at ${item.created_at}`);

    const eventTime = new Date(item.created_at);
    const b = await fetchBars(ctx, eventTime);
    const cal = await fetchCalendar(ctx, eventTime);
    // Probe a holiday and an early close: Thanksgiving 2025 (closed) and the day after (13:00 close).
    const probe = await http<{ date: string; open: string; close: string }[]>(
      'https://paper-api.alpaca.markets/v2/calendar?start=2025-11-26&end=2025-12-01',
      { headers: authHeaders(ctx) },
    );
    const reactions = Object.fromEntries(BAR_SYMBOLS.map((s) => [s, reaction(b.bars[s], eventTime)]));
    const sessionReactions = Object.fromEntries(
      BAR_SYMBOLS.map((s) => [s, sessionReaction(b.bars[s], eventTime, cal.calendar)]),
    );
    const barsOk = BAR_SYMBOLS.every((s) => b.bars[s].length > 0);
    const calendarOk =
      !probe.body.some((d) => d.date === '2025-11-27') && probe.body.find((d) => d.date === '2025-11-28')?.close === '13:00';

    const waitMs = Number(process.env.SPIKE_WS_WAIT_MS ?? 600_000);
    const live = await liveNews(ctx, waitMs);

    const evidence = {
      historical: {
        window: found.window,
        fallbackUsed: found.fallback,
        matchingItems: found.matching,
        windowsTried: found.tried,
        item: { id: item.id, headline: item.headline, created_at: item.created_at, source: item.source, url: item.url, symbols: item.symbols },
      },
      bars: {
        feed: 'sip',
        timeframe: '1Min',
        start: b.start,
        end: b.end,
        pages: b.pages,
        ms: b.ms,
        rateLimitHeaders: b.rateLimit,
        headlineDuringRegularSession: isRegular(cal.calendar, eventTime.getTime()),
        reactionsFromHeadlineAssociationOnly: reactions,
        reactionsSessionAnchoredAssociationOnly: sessionReactions,
      },
      calendar: {
        endpoint: 'GET paper-api.alpaca.markets/v2/calendar',
        ms: cal.ms,
        aroundEvent: cal.days.map((d) => `${d.date} ${d.open}-${d.close}`),
        thanksgiving2025Probe: probe.body.map((d) => `${d.date} ${d.open}-${d.close}`),
        holidayAndEarlyCloseOk: calendarOk,
      },
      live,
    };

    if (!barsOk) return { status: 'fail', reason: 'Missing SIP bars for at least one symbol', evidence, limits };
    if (!calendarOk) return { status: 'fail', reason: 'Market calendar misses a holiday or an early close', evidence, limits };
    if (!live.subscribed) return { status: 'fail', reason: `Live news: ${live.error ?? 'not subscribed'}`, evidence, limits };
    if (!live.item) return { status: 'partial', reason: 'Live stream subscribed but no item arrived in the wait window', evidence, limits };
    return { status: 'pass', evidence, limits };
  },
};

export default check;
