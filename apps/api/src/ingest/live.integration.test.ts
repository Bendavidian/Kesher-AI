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
import { io as connect, type Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { collection } from '../db/collections';
import { createModelClient, MODELS, type ModelClient } from '../llm/client';
import { loadModelRecording, type ModelRecording } from '../llm/recordings';
import { runSeed } from '../seed/seed';
import { recordedModels, signIn, startApi, type TestApi } from '../test/api';
import { mockModel, resolveMocks } from '../test/models';
import { MONGO_START_TIMEOUT_MS, startTestMongo, type TestMongo } from '../test/mongo';
import type { WebSocketLike } from './alpacaStream';
import { submissionsUrl } from './edgar';
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
  afterEach(async () => {
    await api.idle();
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
    expect(await collection(mongo.db, 'recordings').countDocuments({ provider: 'sec_edgar' })).toBe(
      1,
    );

    await live.stop();
    live = undefined;
  }, 15_000);
});
