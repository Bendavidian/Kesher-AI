import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import {
  PriceSymbol,
  REACTION_BENCHMARKS,
  etDate,
  etInstant,
  priceReactionFor,
  resolveAnchor,
} from '@kesher/shared';
import { z } from 'zod';
import { loadAlpacaEnv } from '../config/env';
import { loadRecording } from '../ingest/recordings';
import { fetchBars, fetchCalendar } from './alpaca';
import {
  type BarsRecording,
  type CalendarRecording,
  barsPath,
  calendarPath,
  createMarketData,
  inSession,
} from './data';
import { reactionFixturePath } from './fixture';

// npm run record:bars -- --symbols TSM,NVDA --date 2024-04-03 [--force]
// npm run record:bars -- --event 38062166 --symbols TSM,NVDA [--force]
// Fills the local bar cache (recordings/alpaca-bars/, gitignored) with the regular session bars
// of the symbols plus SMH and SPY, for one trading day and the one before it; with --event, for
// the sessions that item's headline anchors to. Records the market calendar years it reads when
// they are missing (committed). With --event it also writes the computed PriceReaction of the
// item to recordings/price-reactions/<id>.json, the committed test fixture. Run by hand.

const Args = z.object({
  symbols: z
    .string()
    .transform((list) => list.split(',').map((symbol) => symbol.trim()))
    .pipe(z.array(PriceSymbol).min(1)),
  date: z.iso.date().optional(),
  event: z
    .string()
    .regex(/^\d{1,20}$/)
    .optional(),
  force: z.boolean().default(false),
});

const { values } = parseArgs({
  options: {
    symbols: { type: 'string' },
    date: { type: 'string' },
    event: { type: 'string' },
    force: { type: 'boolean' },
  },
});
const args = Args.safeParse(values);
if (!args.success || (args.data.date === undefined) === (args.data.event === undefined)) {
  console.error(
    'Usage: npm run record:bars -- --symbols <T1,T2> (--date <YYYY-MM-DD> | --event <alpaca news id>) [--force]',
  );
  process.exit(1);
}
const { symbols: subjects, date, event, force } = args.data;
const env = loadAlpacaEnv();
const alpaca = { keys: { keyId: env.ALPACA_API_KEY_ID, secretKey: env.ALPACA_API_SECRET_KEY } };
const recordedAt = new Date().toISOString();

async function write(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
  console.log(`Wrote ${path}`);
}

// The headline time of --event. For --date, 08:00 ET that day: before the open, so it anchors to
// the previous close and the date's session, and both are recorded.
let headline: Date;
if (event) {
  const recording = await loadRecording(event);
  if (!recording)
    throw new Error(`No recording for Alpaca news ${event}; run npm run record first`);
  headline = new Date(recording.item.created_at);
} else {
  headline = etInstant(date!, '08:00');
}

// Calendar years around the headline, recorded when missing.
const SPAN_MS = 10 * 24 * 3_600_000;
const from = etDate(new Date(headline.getTime() - SPAN_MS));
const to = etDate(new Date(headline.getTime() + SPAN_MS));
for (let year = Number(from.slice(0, 4)); year <= Number(to.slice(0, 4)); year++) {
  const path = calendarPath(year);
  if (existsSync(path) && !force) continue;
  const days = await fetchCalendar(`${year}-01-01`, `${year}-12-31`, alpaca);
  const recording: CalendarRecording = { provider: 'alpaca', recordedAt, year, days };
  await write(path, recording);
}

const market = createMarketData({ keys: () => alpaca.keys });
const sessions = await market.sessions(from, to);
const resolved = resolveAnchor(sessions, headline);
if (!resolved) throw new Error(`No sessions around ${headline.toISOString()}`);
if (date && resolved.session.date !== date) {
  throw new Error(`${date} is not a trading day in the calendar`);
}
const wanted = [resolved.baseSession, resolved.session].filter(
  (session, index, list) => list.indexOf(session) === index,
);

// Only whole sessions that closed at least 15 minutes ago; the free plan serves nothing newer.
const symbols = [...new Set([...subjects, ...REACTION_BENCHMARKS])];
for (const session of wanted) {
  if (session.close.getTime() + 15 * 60_000 > Date.now()) {
    throw new Error(`The ${session.date} session has not closed 15 minutes ago`);
  }
  const missing = symbols.filter((symbol) => force || !existsSync(barsPath(symbol, session.date)));
  if (missing.length === 0) continue;
  const fetched = await fetchBars(
    missing,
    session.open,
    new Date(session.close.getTime() - 60_000),
    alpaca,
  );
  for (const symbol of missing) {
    const bars = (fetched.get(symbol) ?? []).filter(inSession(session));
    // An empty session would stay in the cache for good, so it needs --force.
    if (bars.length === 0 && !force) {
      throw new Error(
        `Alpaca sent no bars for ${symbol} on ${session.date}; pass --force to keep none`,
      );
    }
    const recording: BarsRecording = {
      provider: 'alpaca',
      feed: 'sip',
      recordedAt,
      symbol,
      date: session.date,
      bars: bars.map((bar) => ({ t: bar.t.toISOString(), o: bar.o, c: bar.c })),
    };
    await write(barsPath(symbol, session.date), recording);
  }
}

if (event) {
  const path = reactionFixturePath(event);
  if (existsSync(path) && !force) {
    console.log(`${path} exists; pass --force to compute it again.`);
  } else {
    const reaction = await priceReactionFor(market, subjects, headline, new Date());
    if (!reaction.complete) throw new Error('The reaction is not complete yet');
    await write(path, { provider: 'alpaca', externalId: event, recordedAt, reaction });
  }
}
