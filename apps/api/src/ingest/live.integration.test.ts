import {
  DEMO_SOURCE_ID,
  FeedCard,
  IngestCounter,
  LiveRecording,
  ReplayResponse,
  SOCKET_EVENTS,
  type AlpacaNewsItem,
  type DropReason,
} from '@kesher/shared';
import { randomUUID } from 'node:crypto';
import { io as connect, type Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { collection } from '../db/collections';
import { createModelClient, MODELS, type ModelClient } from '../llm/client';
import { loadModelRecording, type ModelRecording } from '../llm/recordings';
import { runSeed } from '../seed/seed';
import { recordedModels, signIn, startApi, type TestApi } from '../test/api';
import { mockModel, rateLimitError, resolveMocks, schemaFailureError } from '../test/models';
import { MONGO_START_TIMEOUT_MS, startTestMongo, type TestMongo } from '../test/mongo';
import type { WebSocketLike } from './alpacaStream';
import { submissionsUrl } from './edgar';
import { LIVE_EXTRACTION_DAILY_LIMIT } from './extractionBudget';
import { startLiveIngest, type LiveIngest } from './live';
import { loadRecording } from './recordings';

const now = new Date('2026-09-29T14:00:00Z');
const LIVE_ID = 99000001;

const revive = (value: unknown) =>
  JSON.parse(JSON.stringify(value), (_key, v: unknown) =>
    typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(v) ? new Date(v) : v,
  ) as unknown;

// The Alpaca news WebSocket, played by the test.
class FakeSocket implements WebSocketLike {
  onmessage: WebSocketLike['onmessage'] = null;
  onerror: WebSocketLike['onerror'] = null;
  onclose: WebSocketLike['onclose'] = null;
  send() {}
  close() {
    this.onclose?.({});
  }
  receive(...messages: unknown[]) {
    this.onmessage?.({ data: JSON.stringify(messages) });
  }
}

const until = async (check: () => boolean | Promise<boolean>, timeoutMs = 5_000) => {
  const started = Date.now();
  while (!(await check())) {
    if (Date.now() - started > timeoutMs) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

describe('live ingestion end to end, on mongod', () => {
  let mongo: TestMongo;
  let api: TestApi;
  let recorded: ModelRecording;
  let demo: AlpacaNewsItem;
  let socket: Socket;
  let cards: FeedCard[];
  let live: LiveIngest | undefined;
  const logs: string[] = [];

  const start = (
    models: () => ModelClient,
    sources: Pick<Parameters<typeof startLiveIngest>[0], 'alpaca' | 'edgar' | 'queue'>,
  ) =>
    startLiveIngest({
      db: mongo.db,
      models,
      // What server.ts passes: the pushes, then the research gate.
      ...(api.afterScoring ? { onScored: api.afterScoring } : {}),
      log: (message) => logs.push(message),
      now: () => now,
      ...sources,
    });

  beforeAll(async () => {
    mongo = await startTestMongo('kesher_live_test');
    await runSeed(mongo.db, now);
    recorded = (await loadModelRecording(DEMO_SOURCE_ID))!;
    demo = (await loadRecording(DEMO_SOURCE_ID))!.item;
    // Research mounted and automatic research on, as server.ts runs it. The mock client has no
    // research model, so a run the gate starts fails at its first model call, with no provider.
    api = await startApi(mongo.db, { models: recordedModels(recorded), research: true });
    // Persona A holds NVDA, which TSMC supplies.
    const cookie = await signIn(api.url, 'A');
    socket = await new Promise<Socket>((resolve, reject) => {
      const s = connect(api.url, {
        transports: ['websocket'],
        extraHeaders: { cookie },
        reconnection: false,
      });
      s.once('connect', () => resolve(s));
      s.once('connect_error', reject);
    });
    socket.on(SOCKET_EVENTS.feedItem, (card: unknown) => cards.push(FeedCard.parse(revive(card))));
  }, MONGO_START_TIMEOUT_MS);

  beforeEach(() => {
    cards = [];
  });

  // The runs the gate starts fail in the background; none may still be going in the next test.
  // A test that spends the day's extractions gives them back.
  afterEach(async () => {
    await api.idle();
    await collection(mongo.db, 'ingest_budget').deleteMany({});
  });

  afterAll(async () => {
    await live?.stop();
    socket?.close();
    await api?.close();
    await mongo?.stop();
  });

  it('a live news item reaches the feed with no manual action and can be replayed later', async () => {
    const sockets: FakeSocket[] = [];
    live = start(recordedModels(recorded), {
      alpaca: {
        keys: { keyId: 'key-id', secretKey: 'secret-key' },
        connect: () => {
          const fake = new FakeSocket();
          sockets.push(fake);
          return fake;
        },
      },
    });
    const stream = sockets[0]!;
    stream.receive({ T: 'success', msg: 'connected' });
    stream.receive({ T: 'success', msg: 'authenticated' });
    stream.receive({ T: 'subscription', news: ['*'] });

    // A new TSMC item, as the stream delivers it: the demo item under a fresh id, with the body.
    const item = { ...demo, id: LIVE_ID };
    stream.receive(
      { T: 'n', ...item, content: '<p>Full Benzinga article.</p>' },
      { T: 'n', ...demo, id: LIVE_ID + 1, symbols: ['AAPL', 'SPY'] },
    );

    await until(() => cards.length > 0);
    await live.idle();
    expect(cards).toHaveLength(1);
    expect(cards[0]!.event.headline).toBe(demo.headline);
    expect(cards[0]!.source.externalId).toBe(String(LIVE_ID));
    expect(cards[0]!.item.relevance).toBe(0.8);

    // The gate ran for the live card, as for a replayed one: relevance 0.8 and importance 4 pass,
    // so automatic research started (trigger gate, not skipped) for persona A. Only A's card is
    // checked here; the gate itself is tested in research/auto.integration.test.ts.
    const eventId = cards[0]!.event._id;
    const userId = cards[0]!.item.userId;
    const busy = (state: string) => ['queued', 'running'].includes(state);
    // Settled once the runs and the card's research state have both left queued and running.
    const settled = async () => {
      const runs = await collection(mongo.db, 'agent_runs')
        .find({ eventId, userId, trigger: 'gate' })
        .toArray();
      const item = await collection(mongo.db, 'feed_items').findOne({ eventId, userId });
      return runs.length > 0 && !runs.some((run) => busy(run.status)) && !busy(item!.research.state)
        ? runs
        : null;
    };
    await until(async () => (await settled()) !== null, 10_000);
    const gateRuns = (await settled())!;
    expect(gateRuns.map((run) => run.status)).not.toContain('skipped');
    expect(gateRuns.map((run) => run.mode)).toEqual(['auto']);

    // Recorded once, without the body; the item outside the universe was counted, not recorded.
    const recordings = (await collection(mongo.db, 'recordings').find({}).toArray()).map((doc) =>
      LiveRecording.parse(doc),
    );
    expect(recordings.map((r) => r.externalId)).toEqual([String(LIVE_ID)]);
    expect(recordings[0]!.item).toEqual(item);
    const counters = (await collection(mongo.db, 'ingest_counters').find({}).toArray()).map((doc) =>
      IngestCounter.parse(doc),
    );
    expect(counters.map(({ mode, reason, count }) => ({ mode, reason, count }))).toEqual([
      { mode: 'live', reason: 'not_in_universe', count: 1 },
    ]);

    // The same item again from the stream is a live duplicate and pushes nothing.
    stream.receive({ T: 'n', ...item });
    await until(
      async () =>
        (await collection(mongo.db, 'ingest_counters').countDocuments({ reason: 'duplicate' })) ===
        1,
    );
    await live.idle();
    expect(cards).toHaveLength(1);

    // Later: reset and replay by id, from the recordings collection.
    const reset = await fetch(`${api.url}/dev/reset/${LIVE_ID}`, { method: 'POST' });
    expect(reset.status).toBe(200);
    const replay = await fetch(`${api.url}/dev/replay/${LIVE_ID}`, { method: 'POST' });
    expect(replay.status).toBe(200);
    expect(ReplayResponse.parse(await replay.json())).toMatchObject({
      outcome: 'processed',
      sourceCreated: false,
      eventCreated: false,
    });
    await until(() => cards.length === 2);
    expect(cards[1]!.source.externalId).toBe(String(LIVE_ID));

    await live.stop();
    live = undefined;
  });

  // The recorded answers, from one client whose extraction calls are counted. hold makes the
  // first extraction wait until released, to fill the queue behind it.
  const counted = (hold?: Promise<void>) => {
    const guard = mockModel(MODELS.screen.model, recorded.screen.chunks);
    const groq = mockModel(
      MODELS.extraction.model,
      [recorded.extraction.text],
      undefined,
      (call) => (call === 0 ? hold : undefined),
    );
    const client = createModelClient({
      resolve: resolveMocks({ [guard.modelId]: guard, [groq.modelId]: groq }),
    });
    return { groq, models: () => client };
  };
  const counter = (reason: DropReason) =>
    collection(mongo.db, 'ingest_counters').findOne({ mode: 'live', reason });

  it('the daily cap stops live news extraction without touching replay, Investigate or filings', async () => {
    // Every extraction of the day is taken, by this process or another machine.
    await collection(mongo.db, 'ingest_budget').updateOne(
      { day: now.toISOString().slice(0, 10) },
      {
        $set: { extractions: LIVE_EXTRACTION_DAILY_LIMIT, updatedAt: now },
        $setOnInsert: { _id: randomUUID() },
      },
      { upsert: true },
    );
    const { groq, models } = counted();
    live = start(models, {});
    const id = LIVE_ID + 20;

    await live.handleNews({ ...demo, id });
    await live.idle();

    // Counted and recorded, never stored or extracted.
    expect(await counter('daily_cap')).toMatchObject({ count: 1 });
    expect(groq.doGenerateCalls).toHaveLength(0);
    expect(await collection(mongo.db, 'sources').countDocuments({ externalId: String(id) })).toBe(
      0,
    );
    expect(
      await collection(mongo.db, 'recordings').countDocuments({ externalId: String(id) }),
    ).toBe(1);
    expect(logs).toContain(`live alpaca ${id} is past today's extraction cap`);

    // Replay of the same item extracts it: the cap is live only.
    const replay = await fetch(`${api.url}/dev/replay/${id}`, { method: 'POST' });
    expect(replay.status).toBe(200);
    const replayed = ReplayResponse.parse(await replay.json());
    expect(replayed).toMatchObject({ outcome: 'processed', sourceCreated: true });
    if (replayed.outcome !== 'processed') throw new Error('not processed');

    // Investigate on its card is untouched: the research budget is its own. The gate queued an
    // automatic run for the replayed card first; once it has ended, Investigate may start one.
    await api.idle();
    const cookie = await signIn(api.url, 'A');
    const investigate = await fetch(`${api.url}/events/${replayed.eventId}/investigate`, {
      method: 'POST',
      headers: { cookie },
    });
    expect(investigate.status).toBe(202);

    // A filing never waits on the cap.
    await live.handleFiling(
      {
        cik: '0001045810',
        accessionNumber: '0001045810-26-000091',
        form: '8-K',
        filingDate: '2026-09-29',
        acceptanceDateTime: '2026-09-29T12:03:56.000Z',
        primaryDocument: 'nvda-8k.htm',
        items: '8.01',
      },
      { symbol: 'NVDA', cik: '0001045810', name: 'NVIDIA Corp' },
    );
    await live.idle();
    const filing = await collection(mongo.db, 'sources').findOne({
      externalId: '0001045810-26-000091',
    });
    const filingEvent = await collection(mongo.db, 'market_events').findOne({
      sourceIds: filing!._id,
    });
    expect(filingEvent?.extraction).not.toBeNull();
    expect(await counter('daily_cap')).toMatchObject({ count: 1 });

    await live.stop();
    live = undefined;
  }, 15_000);

  it('a live item retried after a 429 takes one extraction of the day, not one per try', async () => {
    const guard = mockModel(MODELS.screen.model, recorded.screen.chunks);
    const groq = mockModel(MODELS.extraction.model, [rateLimitError(), recorded.extraction.text]);
    const gemini = mockModel(MODELS.fallback.model, [rateLimitError()]);
    // A client per call, as each has its own limiter: a shared one would block the retry for the
    // 60 seconds a 429 without retry-after holds a model.
    const models = () =>
      createModelClient({
        resolve: resolveMocks({
          [guard.modelId]: guard,
          [groq.modelId]: groq,
          [gemini.modelId]: gemini,
        }),
      });
    live = start(models, { queue: { retryDelayMs: 10 } });
    const id = LIVE_ID + 25;

    await live.handleNews({ ...demo, id });
    await until(async () => {
      await live!.idle();
      return groq.doGenerateCalls.length === 2;
    });
    await live.idle();

    const source = await collection(mongo.db, 'sources').findOne({ externalId: String(id) });
    const event = await collection(mongo.db, 'market_events').findOne({ sourceIds: source!._id });
    expect(event?.extraction).not.toBeNull();
    const budget = await collection(mongo.db, 'ingest_budget').findOne({
      day: now.toISOString().slice(0, 10),
    });
    expect(budget?.extractions).toBe(1);

    await live.stop();
    live = undefined;
  }, 15_000);

  it('a full live queue sheds its oldest waiting item and counts it', async () => {
    let release!: () => void;
    const hold = new Promise<void>((resolve) => (release = resolve));
    const { models } = counted(hold);
    live = start(models, { queue: { limit: 1 } });
    const [first, shed, last] = [LIVE_ID + 30, LIVE_ID + 31, LIVE_ID + 32];

    await live.handleNews({ ...demo, id: first });
    await live.handleNews({ ...demo, id: shed });
    await live.handleNews({ ...demo, id: last });
    await until(async () => (await counter('queue_full')) !== null);
    release();
    await live.idle();

    expect(await counter('queue_full')).toMatchObject({ count: 1 });
    expect(logs).toContain(`live queue full (1 waiting); dropped alpaca ${shed}`);
    const stored = await collection(mongo.db, 'sources')
      .find({ externalId: { $in: [first, shed, last].map(String) } })
      .toArray();
    expect(stored.map((source) => source.externalId).sort()).toEqual([String(first), String(last)]);
    // The shed item stays recorded for a replay.
    expect(
      await collection(mongo.db, 'recordings').countDocuments({ externalId: String(shed) }),
    ).toBe(1);

    await live.stop();
    live = undefined;
  }, 15_000);

  it('after a drop, items published while the stream was down arrive from the history, each once', async () => {
    const { groq, models } = counted();
    const sockets: FakeSocket[] = [];
    // The news history endpoint, played by the test: what it returns, and what it was asked.
    let history: AlpacaNewsItem[] = [];
    const asked: URL[] = [];
    const fetch: typeof globalThis.fetch = (url) => {
      asked.push(new URL(url instanceof Request ? url.url : url));
      return Promise.resolve(
        new Response(JSON.stringify({ news: history, next_page_token: null }), { status: 200 }),
      );
    };
    live = start(models, {
      alpaca: {
        keys: { keyId: 'key-id', secretKey: 'secret-key' },
        connect: () => {
          const fake = new FakeSocket();
          sockets.push(fake);
          return fake;
        },
        fetch,
        minBackoffMs: 10,
      },
    });
    const subscribe = (socket: FakeSocket) => {
      socket.receive({ T: 'success', msg: 'connected' });
      socket.receive({ T: 'success', msg: 'authenticated' });
      socket.receive({ T: 'subscription', news: ['*'] });
    };
    const [streamed, missed, alsoMissed] = [LIVE_ID + 40, LIVE_ID + 41, LIVE_ID + 42];
    const item = (id: number) => ({ ...demo, id });
    const duplicates = async () => (await counter('duplicate'))?.count ?? 0;

    // First subscription of the process: the gap from the newest recording is empty.
    subscribe(sockets[0]!);
    await live.idle();
    sockets[0]!.receive({ T: 'n', ...item(streamed) });
    await until(async () => {
      await live!.idle();
      return groq.doGenerateCalls.length === 1;
    });
    const before = { calls: groq.doGenerateCalls.length, duplicates: await duplicates() };

    // The stream drops; two items are published while it is down, which only the history has.
    sockets[0]!.close();
    history = [item(streamed), item(missed), item(alsoMissed)];
    await until(() => sockets.length === 2);
    subscribe(sockets[1]!);
    await until(async () => {
      await live!.idle();
      return groq.doGenerateCalls.length === before.calls + 2;
    });

    // The gap ran from a minute before the last streamed message, for the universe symbols.
    const gap = asked.at(-1)!;
    expect(gap.searchParams.get('start')).toBe('2026-09-29T13:59:00.000Z');
    expect(gap.searchParams.get('end')).toBe('2026-09-29T14:00:00.000Z');
    expect(gap.searchParams.get('symbols')!.split(',')).toEqual(
      expect.arrayContaining(['NVDA', 'TSM', 'KO']),
    );
    for (const id of [missed, alsoMissed]) {
      const source = await collection(mongo.db, 'sources').findOne({ externalId: String(id) });
      const event = await collection(mongo.db, 'market_events').findOne({
        sourceIds: source!._id,
      });
      expect(event?.extraction).not.toBeNull();
      expect(
        await collection(mongo.db, 'recordings').countDocuments({ externalId: String(id) }),
      ).toBe(1);
    }
    // The streamed item came back in the history and was skipped before the pipeline.
    expect(await duplicates()).toBe(before.duplicates);

    // A second drop with the same history brings nothing new: no model call, no counter.
    sockets[1]!.close();
    await until(() => sockets.length === 3);
    subscribe(sockets[2]!);
    await until(() => asked.length === 3);
    await live.idle();
    expect(groq.doGenerateCalls).toHaveLength(before.calls + 2);
    expect(await duplicates()).toBe(before.duplicates);

    await live.stop();
    live = undefined;
  }, 15_000);

  it('the gap fill never hands over an item this process accepted, a capped one included', async () => {
    await collection(mongo.db, 'ingest_budget').updateOne(
      { day: now.toISOString().slice(0, 10) },
      {
        $set: { extractions: LIVE_EXTRACTION_DAILY_LIMIT, updatedAt: now },
        $setOnInsert: { _id: randomUUID() },
      },
      { upsert: true },
    );
    const { groq, models } = counted();
    const sockets: FakeSocket[] = [];
    const capped = { ...demo, id: LIVE_ID + 50 };
    let history: AlpacaNewsItem[] = [];
    let asked = 0;
    const fetch: typeof globalThis.fetch = () => {
      asked += 1;
      return Promise.resolve(
        new Response(JSON.stringify({ news: history, next_page_token: null }), { status: 200 }),
      );
    };
    live = start(models, {
      alpaca: {
        keys: { keyId: 'key-id', secretKey: 'secret-key' },
        connect: () => {
          const fake = new FakeSocket();
          sockets.push(fake);
          return fake;
        },
        fetch,
        minBackoffMs: 10,
      },
    });
    const subscribe = (socket: FakeSocket) => {
      socket.receive({ T: 'success', msg: 'connected' });
      socket.receive({ T: 'success', msg: 'authenticated' });
      socket.receive({ T: 'subscription', news: ['*'] });
    };
    const capCount = ((await counter('daily_cap'))?.count ?? 0) + 1;
    subscribe(sockets[0]!);
    sockets[0]!.receive({ T: 'n', ...capped });
    await until(async () => (await counter('daily_cap'))?.count === capCount);

    sockets[0]!.close();
    history = [capped];
    await until(() => sockets.length === 2);
    subscribe(sockets[1]!);
    await until(() => asked === 2);
    await live.idle();

    expect((await counter('daily_cap'))!.count).toBe(capCount);
    expect(groq.doGenerateCalls).toHaveLength(0);

    await live.stop();
    live = undefined;
  }, 15_000);

  it('a restart hands over no processed filing again and resumes one that failed, once', async () => {
    const filing = (accession: string, accepted: string) => [accession, accepted] as const;
    const done = filing('0001045810-26-000086', '2026-09-29T12:10:00.000Z');
    const failed = filing('0001045810-26-000087', '2026-09-29T12:20:00.000Z');
    const submissions = {
      filings: {
        recent: {
          accessionNumber: [done[0], failed[0]],
          form: ['8-K', '8-K'],
          filingDate: ['2026-09-29', '2026-09-29'],
          acceptanceDateTime: [done[1], failed[1]],
          primaryDocument: ['a.htm', 'b.htm'],
          items: ['8.01', '8.01'],
        },
      },
    };
    let requests = 0;
    const fetch: typeof globalThis.fetch = (url) => {
      requests += 1;
      const nvidia = url === submissionsUrl('0001045810');
      return Promise.resolve(
        new Response(
          JSON.stringify(
            nvidia
              ? submissions
              : {
                  filings: {
                    recent: {
                      accessionNumber: [],
                      form: [],
                      filingDate: [],
                      acceptanceDateTime: [],
                      primaryDocument: [],
                      items: [],
                    },
                  },
                },
          ),
        ),
      );
    };
    const extraction = JSON.stringify({
      companies: [{ symbol: 'NVDA', impact: 'neutral' }],
      eventType: 'other',
      importance: 2,
      themes: [],
    });
    // Each process gets its own models; groq answers in call order.
    const modelsFor = (groqReplies: (string | Error)[]) => {
      const guard = mockModel(MODELS.screen.model, ['0.001']);
      const groq = mockModel(MODELS.extraction.model, groqReplies);
      const gemini = mockModel(MODELS.fallback.model, ['{"themes":3}']);
      const models = () =>
        createModelClient({
          resolve: resolveMocks({
            [guard.modelId]: guard,
            [groq.modelId]: groq,
            [gemini.modelId]: gemini,
          }),
        });
      return { groq, models };
    };
    const run = async (groqReplies: (string | Error)[]) => {
      const { groq, models } = modelsFor(groqReplies);
      const polled = requests + 17;
      live = start(models, { edgar: { userAgent: 'Kesher test', fetch, intervalMs: 3_600_000 } });
      await until(() => requests >= polled, 10_000);
      await live.idle();
      await live.stop();
      live = undefined;
      return groq.doGenerateCalls.length;
    };
    const extracted = async (accession: string) => {
      const source = await collection(mongo.db, 'sources').findOne({ externalId: accession });
      const event =
        source && (await collection(mongo.db, 'market_events').findOne({ sourceIds: source._id }));
      return Boolean(event?.extraction);
    };

    // First process: the first filing is extracted, the second fails its schema everywhere.
    expect(await run([extraction, schemaFailureError()])).toBe(3);
    expect(await extracted(done[0])).toBe(true);
    expect(await extracted(failed[0])).toBe(false);
    expect(await counter('extraction_failed')).toMatchObject({ count: 1 });
    const duplicates = (await counter('duplicate'))?.count ?? 0;

    // After a restart only the failed filing comes again, and is extracted once.
    expect(await run([extraction])).toBe(1);
    expect(await extracted(failed[0])).toBe(true);

    // A third start hands over nothing and counts nothing.
    expect(await run([])).toBe(0);
    expect((await counter('duplicate'))?.count ?? 0).toBe(duplicates);
    expect(
      await collection(mongo.db, 'recordings').countDocuments({
        externalId: { $in: [done[0], failed[0]] },
      }),
    ).toBe(2);
  }, 20_000);

  it('a new EDGAR filing of a universe company reaches its holder', async () => {
    // A synthetic extraction naming NVIDIA, for a synthetic 8-K.
    const guard = mockModel(MODELS.screen.model, ['0.001']);
    const groq = mockModel(MODELS.extraction.model, [
      JSON.stringify({
        companies: [{ symbol: 'NVDA', impact: 'positive' }],
        eventType: 'earnings',
        importance: 4,
        themes: ['ai_accelerators'],
      }),
    ]);
    const models = () =>
      createModelClient({
        resolve: resolveMocks({ [guard.modelId]: guard, [groq.modelId]: groq }),
      });
    const empty = {
      filings: {
        recent: {
          accessionNumber: [],
          form: [],
          filingDate: [],
          acceptanceDateTime: [],
          primaryDocument: [],
          items: [],
        },
      },
    };
    const nvidia = {
      filings: {
        recent: {
          accessionNumber: ['0001045810-26-000080'],
          form: ['8-K'],
          filingDate: ['2026-09-29'],
          acceptanceDateTime: ['2026-09-29T12:03:56.000Z'],
          primaryDocument: ['nvda-8k.htm'],
          items: ['2.02,9.01'],
        },
      },
    };
    const fetch: typeof globalThis.fetch = (url) =>
      Promise.resolve(
        new Response(JSON.stringify(url === submissionsUrl('0001045810') ? nvidia : empty)),
      );
    live = start(models, {
      edgar: {
        userAgent: 'Kesher test',
        fetch,
        intervalMs: 3_600_000,
      },
    });

    await until(() => cards.length > 0, 10_000);
    await live.idle();
    expect(cards[0]!.source).toMatchObject({
      provider: 'sec_edgar',
      tier: 1,
      externalId: '0001045810-26-000080',
      title:
        'NVIDIA Corp 8-K: Results of Operations and Financial Condition; Financial Statements and Exhibits',
    });
    expect(cards[0]!.item.relevance).toBe(1);
    expect(
      await collection(mongo.db, 'recordings').countDocuments({
        provider: 'sec_edgar',
        externalId: '0001045810-26-000080',
      }),
    ).toBe(1);

    await live.stop();
    live = undefined;
  }, 15_000);
});
