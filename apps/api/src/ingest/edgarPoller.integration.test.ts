import type { EdgarFiling } from '@kesher/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { collection } from '../db/collections';
import { scoreEvent } from '../relevance/feed';
import { runSeed } from '../seed/seed';
import { MONGO_START_TIMEOUT_MS, startTestMongo, type TestMongo } from '../test/mongo';
import { submissionsUrl } from './edgar';
import { createEdgarPoller } from './edgarPoller';
import { ingestItem } from './ingest';
import { toIncomingFiling } from './edgar';

const now = new Date('2026-09-29T14:00:00Z');

const recent = (rows: [string, string, string][]) => ({
  filings: {
    recent: {
      accessionNumber: rows.map((r) => r[0]),
      form: rows.map(() => '8-K'),
      filingDate: rows.map((r) => r[1].slice(0, 10)),
      acceptanceDateTime: rows.map((r) => r[1]),
      primaryDocument: rows.map((r) => r[2]),
      items: rows.map(() => '8.01'),
    },
  },
});

describe('EDGAR poller on mongod', () => {
  let mongo: TestMongo;
  let handed: { filing: EdgarFiling; symbol: string }[];
  let logs: string[];
  let answers: Map<string, unknown>;
  let requests: string[];

  // The poller always passes the URL as a string.
  const fetch: typeof globalThis.fetch = (url) => {
    requests.push(url as string);
    const body = answers.get(url as string);
    if (body === 'fail') return Promise.resolve(new Response('busy', { status: 503 }));
    if (typeof body === 'number') return Promise.resolve(new Response('', { status: body }));
    return Promise.resolve(new Response(JSON.stringify(body ?? recent([]))));
  };

  const poller = () =>
    createEdgarPoller({
      db: mongo.db,
      userAgent: 'Kesher test',
      onFiling: (filing, company) => {
        handed.push({ filing, symbol: company.symbol });
      },
      log: (message) => logs.push(message),
      fetch,
      now: () => now,
      gapMs: 0,
    });

  beforeAll(async () => {
    mongo = await startTestMongo('kesher_edgar_poller_test');
    await runSeed(mongo.db, now);
  }, MONGO_START_TIMEOUT_MS);

  beforeEach(async () => {
    handed = [];
    logs = [];
    requests = [];
    answers = new Map();
    const filings = await collection(mongo.db, 'sources')
      .find({ externalId: /^0001045810-26-0001/ })
      .toArray();
    const ids = filings.map((f) => f._id);
    const events = await collection(mongo.db, 'market_events')
      .find({ sourceIds: { $in: ids } })
      .toArray();
    await collection(mongo.db, 'feed_items').deleteMany({
      eventId: { $in: events.map((e) => e._id) },
    });
    await collection(mongo.db, 'market_events').deleteMany({ sourceIds: { $in: ids } });
    await collection(mongo.db, 'sources').deleteMany({ _id: { $in: ids } });
  });

  afterAll(async () => {
    await mongo?.stop();
  });

  it('asks EDGAR once per universe company and maps each filing to its filer symbol', async () => {
    answers.set(
      submissionsUrl('0001045810'),
      recent([['0001045810-26-000100', '2026-09-29T12:00:00.000Z', 'a.htm']]),
    );
    await poller().poll();
    expect(requests).toHaveLength(17);
    expect(handed.map((h) => [h.symbol, h.filing.accessionNumber])).toEqual([
      ['NVDA', '0001045810-26-000100'],
    ]);
  });

  it('hands a filing over once, skips one already processed or older than the lookback, and resumes one stored without processing', async () => {
    const nvidia = { symbol: 'NVDA', cik: '0001045810', name: 'NVIDIA Corp' } as const;
    const filing = (accessionNumber: string, acceptanceDateTime: string) => ({
      cik: nvidia.cik,
      accessionNumber,
      form: '8-K',
      filingDate: acceptanceDateTime.slice(0, 10),
      acceptanceDateTime,
      primaryDocument: 'b.htm',
      items: '8.01',
    });
    // Processed: extracted and scored for every user.
    const done = filing('0001045810-26-000101', '2026-09-29T11:00:00.000Z');
    const ingested = await ingestItem(mongo.db, toIncomingFiling(done, nvidia), now);
    await collection(mongo.db, 'market_events').updateOne(
      { _id: ingested.eventId },
      {
        $set: {
          extraction: {
            companies: [{ symbol: 'NVDA', impact: 'neutral' }],
            eventType: 'other',
            themes: [],
            importance: 2,
            provider: 'groq',
            model: 'openai/gpt-oss-120b',
            extractedAt: now,
          },
        },
      },
    );
    await scoreEvent(mongo.db, ingested.eventId, now);
    // Stored, but its extraction never ran (a daily quota, a restart): it must come again.
    const stalled = filing('0001045810-26-000105', '2026-09-29T10:00:00.000Z');
    await ingestItem(mongo.db, toIncomingFiling(stalled, nvidia), now);

    answers.set(
      submissionsUrl('0001045810'),
      recent([
        ['0001045810-26-000102', '2026-09-29T13:00:00.000Z', 'c.htm'],
        [done.accessionNumber, done.acceptanceDateTime, 'b.htm'],
        [stalled.accessionNumber, stalled.acceptanceDateTime, 'b.htm'],
        ['0001045810-26-000103', '2026-09-27T13:00:00.000Z', 'old.htm'],
      ]),
    );
    const p = poller();
    await p.poll();
    await p.poll();
    expect(handed.map((h) => h.filing.accessionNumber)).toEqual([
      '0001045810-26-000102',
      stalled.accessionNumber,
    ]);
    // Nothing reached processItem as a repeat, so no drop was counted.
    expect(await collection(mongo.db, 'ingest_counters').countDocuments()).toBe(0);
  });

  it('goes on past failing filers and names them in one line per poll', async () => {
    answers.set(submissionsUrl('0000002488'), 'fail');
    answers.set(submissionsUrl('0000006951'), 'fail');
    answers.set(
      submissionsUrl('0001045810'),
      recent([['0001045810-26-000104', '2026-09-29T12:00:00.000Z', 'd.htm']]),
    );
    await poller().poll();
    expect(handed).toHaveLength(1);
    expect(logs).toEqual([
      'edgar poll failed for 2 of 17 companies (AMAT, AMD): SecHttpError: HTTP 503 from https://data.sec.gov/submissions/CIK0000006951.json',
    ]);
  });

  it('pauses every request after a 403 or 429, says so once, doubles the pause and resets', async () => {
    let clock = now.getTime();
    const minutes = (n: number) => n * 60_000;
    const p = createEdgarPoller({
      db: mongo.db,
      userAgent: 'Kesher test',
      onFiling: () => undefined,
      log: (message) => logs.push(message),
      fetch,
      now: () => new Date(clock),
      gapMs: 0,
    });
    // AMAT comes first in symbol order.
    answers.set(submissionsUrl('0000006951'), 429);

    await p.poll();
    expect(requests).toHaveLength(1);
    expect(logs).toEqual(['edgar answered 429; every poll pauses for 10 min']);
    expect(p.status()).toEqual({ lastPollAt: null, pausedUntil: new Date(clock + minutes(10)) });

    // Within the pause no request goes out.
    clock += minutes(9);
    await p.poll();
    expect(requests).toHaveLength(1);

    clock += minutes(1);
    await p.poll();
    expect(requests).toHaveLength(2);
    expect(logs.at(-1)).toBe('edgar answered 429; every poll pauses for 20 min');

    clock += minutes(20);
    answers.delete(submissionsUrl('0000006951'));
    await p.poll();
    expect(requests).toHaveLength(2 + 17);
    expect(p.status()).toEqual({ lastPollAt: new Date(clock), pausedUntil: null });

    // After a clean poll the next pause starts at 10 minutes again.
    answers.set(submissionsUrl('0000006951'), 403);
    await p.poll();
    expect(logs.at(-1)).toBe('edgar answered 403; every poll pauses for 10 min');
    expect(logs).toHaveLength(3);
  });

  it('start polls at once and again after the interval; stop ends it', async () => {
    const p = createEdgarPoller({
      db: mongo.db,
      userAgent: 'Kesher test',
      onFiling: () => undefined,
      fetch,
      now: () => now,
      gapMs: 0,
      intervalMs: 20,
      log: () => undefined,
    });
    p.start();
    const started = Date.now();
    while (requests.length < 34 && Date.now() - started < 5_000) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    await p.stop();
    const count = requests.length;
    expect(count).toBeGreaterThanOrEqual(34);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(requests.length).toBe(count);
  });
});
