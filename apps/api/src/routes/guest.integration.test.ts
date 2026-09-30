import {
  AgentRun,
  DEMO_SOURCE_ID,
  FeedCard,
  GUEST_TTL_MS,
  PublicUser,
  relevanceBand,
  RunSummary,
  SOCKET_EVENTS,
  type Source,
} from '@kesher/shared';
import { io as connect, type Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { collection } from '../db/collections';
import { MAX_LIVE_GUESTS } from '../guest/guest';
import { toIncomingItem } from '../ingest/alpaca';
import { processItem } from '../ingest/process';
import { loadRecording } from '../ingest/recordings';
import { createModelClient, MODELS, type ModelClient } from '../llm/client';
import { loadModelRecording } from '../llm/recordings';
import { loadReactionFixture } from '../market/fixture';
import { autoResearch } from '../research/auto';
import { AUTO_RUN_LIMIT, GUEST_RUN_LIMIT } from '../research/dailyBudget';
import { runSeed } from '../seed/seed';
import {
  recordedModels,
  sessionCookieOf,
  signIn,
  startApi,
  TEST_MCP_SECRET,
  type TestApi,
} from '../test/api';
import { mockModel, resolveMocks, type ModelReply } from '../test/models';
import { MONGO_START_TIMEOUT_MS, startTestMongo, type TestMongo } from '../test/mongo';

const eventTime = new Date('2026-09-29T12:00:00Z');

const revive = (value: unknown) =>
  JSON.parse(JSON.stringify(value), (_key, v: unknown) =>
    typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(v) ? new Date(v) : v,
  ) as unknown;

interface Guest {
  user: PublicUser;
  cookie: string;
}

describe('guest portfolios, on mongod (T24)', () => {
  let mongo: TestMongo;
  let api: TestApi;
  let eventId: string;
  let demo: Source;
  let research: ModelClient;
  // Every model client the api asked for: guest creation and rescoring must ask for none.
  let modelClients = 0;
  const sockets: Socket[] = [];

  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${api.url}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
  const put = (path: string, body: unknown, cookie: string) =>
    fetch(`${api.url}${path}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify(body),
    });
  const get = (path: string, cookie: string) => fetch(`${api.url}${path}`, { headers: { cookie } });

  const createGuest = async (symbols: string[]): Promise<Guest> => {
    const response = await post('/guest', { symbols });
    expect(response.status).toBe(201);
    const user = PublicUser.parse(revive(await response.json()));
    return { user, cookie: sessionCookieOf(response) };
  };
  const feedOf = async (cookie: string) => {
    const response = await get('/feed', cookie);
    expect(response.status).toBe(200);
    return ((await response.json()) as unknown[]).map((card) => FeedCard.parse(revive(card)));
  };
  const investigate = (cookie: string) =>
    fetch(`${api.url}/events/${eventId}/investigate`, { method: 'POST', headers: { cookie } });
  const settled = async (userId: string) => {
    for (let i = 0; i < 500; i += 1) {
      const item = await collection(mongo.db, 'feed_items').findOne({ userId, eventId });
      if (item && item.research.state !== 'queued' && item.research.state !== 'running') {
        return item;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('research never settled');
  };

  // The research model: get_event, then a report with one verbatim fact.
  const useModel = () => {
    const replies: ModelReply[] = [
      { toolCalls: [{ toolName: 'get_event', input: { eventId } }] },
      {
        toolCalls: [
          {
            toolName: 'submit_report',
            input: {
              claims: [
                {
                  key: 'c1',
                  type: 'fact',
                  text: 'TSMC paused some production after the earthquake.',
                  sources: [{ sourceId: demo._id, quote: demo.text!.slice(0, 80) }],
                  premises: [],
                  figures: [],
                },
              ],
              openQuestions: [],
            },
          },
        ],
      },
    ];
    const gemini = mockModel(MODELS.research.model, replies);
    const groq = mockModel(MODELS.extraction.model, [
      JSON.stringify({
        verdicts: ['k1', 'k2', 'k3'].map((claim) => ({
          claim,
          verdict: 'supported',
          priceCause: false,
          reason: 'stated',
        })),
      }),
    ]);
    research = createModelClient({
      resolve: resolveMocks({ [gemini.modelId]: gemini, [groq.modelId]: groq }),
    });
  };

  beforeAll(async () => {
    mongo = await startTestMongo('kesher_guest_test');
    await runSeed(mongo.db, eventTime);
    const result = await processItem(
      mongo.db,
      toIncomingItem((await loadRecording(DEMO_SOURCE_ID))!.item),
      {
        mode: 'replay',
        models: recordedModels((await loadModelRecording(DEMO_SOURCE_ID))!),
        now: () => eventTime,
        log: () => {},
      },
    );
    if (result.outcome !== 'processed') throw new Error('expected processed');
    eventId = result.eventId;
    demo = (await collection(mongo.db, 'sources').findOne({ _id: result.sourceId }))!;
    const { reaction } = await loadReactionFixture(DEMO_SOURCE_ID);
    api = await startApi(mongo.db, {
      models: () => {
        modelClients += 1;
        return research;
      },
      research: true,
      priceReactions: () => Promise.resolve(reaction),
      // Many guests in this file; the limit has its own test below.
      guest: { createLimit: 1000 },
    });
  }, MONGO_START_TIMEOUT_MS);

  beforeEach(async () => {
    useModel();
    modelClients = 0;
    await collection(mongo.db, 'research_budget').deleteMany({});
  });

  afterEach(async () => {
    await api.idle();
    for (const socket of sockets.splice(0)) socket.close();
  });

  afterAll(async () => {
    await api?.close();
    await mongo?.stop();
  });

  it('creates a guest whose feed is scored at once, with no model call', async () => {
    const before = Date.now();
    const { user, cookie } = await createGuest(['NVDA', 'KO']);
    expect(user.displayName).toBe('Your portfolio');
    expect(user.holdings).toEqual([
      { symbol: 'NVDA', quantity: 1 },
      { symbol: 'KO', quantity: 1 },
    ]);
    const expiresAt = user.expiresAt!.getTime();
    expect(expiresAt).toBeGreaterThanOrEqual(before + GUEST_TTL_MS);
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + GUEST_TTL_MS);

    // The same card as persona A, which also holds NVDA: TSMC supplies NVIDIA.
    const [card, ...rest] = await feedOf(cookie);
    expect(rest).toEqual([]);
    expect(card!.item.userId).toBe(user._id);
    expect(card!.item.relevance).toBe(0.8);
    expect(relevanceBand(card!.item.relevance)).toBe('medium');
    expect(card!.item.path?.hops.map((hop) => [hop.from, hop.to])).toEqual([['TSM', 'NVDA']]);
    expect(card!.evidence).toHaveLength(1);
    // A backfilled item takes the event's arrival in the personas' feeds, so the arrival order
    // matches a persona's.
    const personaItem = await collection(mongo.db, 'feed_items').findOne({
      eventId,
      expiresAt: { $exists: false },
    });
    expect(card!.item.createdAt).toEqual(personaItem!.createdAt);

    const explain = (await (await get(`/events/${eventId}/explain`, cookie)).json()) as {
      relevance: number;
    };
    expect(explain.relevance).toBe(card!.item.relevance);
    const stored = await collection(mongo.db, 'feed_items').findOne({ userId: user._id });
    expect(stored!.expiresAt).toEqual(user.expiresAt);
    expect(modelClients).toBe(0);

    // A direct holding is high, and GET /me knows the guest.
    const tsm = await createGuest(['TSM']);
    expect((await feedOf(tsm.cookie))[0]!.item.relevance).toBe(1);
    const me = PublicUser.parse(revive(await (await get('/me', tsm.cookie)).json()));
    expect(me._id).toBe(tsm.user._id);
  });

  it('lists a guest its own relevance 0 events in GET /feed/hidden', async () => {
    const guest = await createGuest(['KO']);
    const response = await get('/feed/hidden', guest.cookie);
    expect(response.status).toBe(200);
    const hidden = (await response.json()) as {
      recent: { event: { _id: string }; relevance: number }[];
      total: number;
    };
    expect(hidden.total).toBe(1);
    expect(hidden.recent.map((explain) => [explain.event._id, explain.relevance])).toEqual([
      [eventId, 0],
    ]);
    expect(await feedOf(guest.cookie)).toEqual([]);
  });

  it('refuses anything but 1 to 6 distinct universe companies, and a user id', async () => {
    const users = await collection(mongo.db, 'users').countDocuments();
    for (const body of [
      {},
      { symbols: [] },
      { symbols: ['NVDA', 'MSFT', 'AMZN', 'GOOGL', 'META', 'AMD', 'AVGO'] },
      { symbols: ['NVDA', 'NVDA'] },
      { symbols: ['SPY'] },
      { symbols: ['NVDA'], userId: '00000000-0000-4000-8000-000000000001' },
    ]) {
      expect((await post('/guest', body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(await collection(mongo.db, 'users').countDocuments()).toBe(users);
  });

  it('never signs a guest in by password', async () => {
    const { user } = await createGuest(['NVDA']);
    const response = await post('/auth/login', { email: user.email, password: 'none$guest' });
    expect(response.status).toBe(401);
  });

  it('shows a guest only its own feed, reports and runs', async () => {
    const first = await createGuest(['NVDA']);
    const second = await createGuest(['NVDA']);
    const personaA = await signIn(api.url, 'A');

    const socket = connect(api.url, {
      transports: ['websocket'],
      extraHeaders: { cookie: second.cookie },
      reconnection: false,
    });
    sockets.push(socket);
    const pushed: unknown[] = [];
    socket.on(SOCKET_EVENTS.feedUpdate, (card: unknown) => pushed.push(card));
    socket.on(SOCKET_EVENTS.runStep, (step: unknown) => pushed.push(step));
    await new Promise<void>((resolve) => socket.once('connect', () => resolve()));

    expect((await investigate(first.cookie)).status).toBe(202);
    const done = await settled(first.user._id);
    expect(done.research.state).toBe('done');
    const reportId = done.research.reportId!;
    const runId = done.research.runId!;
    expect((await get(`/reports/${reportId}`, first.cookie)).status).toBe(200);

    // The same event, a different guest: its own item, none of the first one's research.
    const [card] = await feedOf(second.cookie);
    expect(card!.item.userId).toBe(second.user._id);
    expect(card!.item.research.state).toBe('none');
    expect((await get(`/reports/${reportId}`, second.cookie)).status).toBe(404);
    expect((await get(`/runs/${runId}`, second.cookie)).status).toBe(404);
    const runs = ((await (await get('/runs', second.cookie)).json()) as unknown[]).map((row) =>
      RunSummary.parse(revive(row)),
    );
    expect(runs).toEqual([]);
    // Nor a persona.
    expect((await get(`/reports/${reportId}`, personaA)).status).toBe(404);
    await api.idle();
    expect(pushed).toEqual([]);

    // The run, its report and its claims expire with the first guest.
    const expiresAt = first.user.expiresAt;
    const run = AgentRun.parse(await collection(mongo.db, 'agent_runs').findOne({ _id: runId }));
    expect(run.expiresAt).toEqual(expiresAt);
    const report = await collection(mongo.db, 'reports').findOne({ _id: reportId });
    expect(report!.expiresAt).toEqual(expiresAt);
    const claims = await collection(mongo.db, 'claims').find({ reportId }).toArray();
    expect(claims.length).toBeGreaterThan(0);
    expect(claims.every((claim) => claim.expiresAt?.getTime() === expiresAt!.getTime())).toBe(true);
  });

  it('gives a guest one Investigate a UTC day, from the guests share of the budget', async () => {
    const guest = await createGuest(['TSM']);
    expect((await investigate(guest.cookie)).status).toBe(202);
    await settled(guest.user._id);
    const budget = () => collection(mongo.db, 'research_budget').findOne({});
    expect(await budget()).toMatchObject({ runs: 1, guestRuns: 1 });
    const run = await collection(mongo.db, 'agent_runs').findOne({ userId: guest.user._id });
    expect(run!.gate.reason).toContain(`guest run 1 of ${GUEST_RUN_LIMIT} today`);

    const again = await investigate(guest.cookie);
    expect(again.status).toBe(429);
    expect(((await again.json()) as { error: string }).error).toBe(
      'A guest portfolio gets one research run a day, and this one is used. It resets at 00:00 UTC.',
    );
    expect(await budget()).toMatchObject({ runs: 1, guestRuns: 1 });

    // The guests together: the 11th guest run of a day is refused, and the guest keeps its day.
    await collection(mongo.db, 'research_budget').updateOne(
      {},
      { $set: { guestRuns: GUEST_RUN_LIMIT } },
    );
    const late = await createGuest(['TSM']);
    const refused = await investigate(late.cookie);
    expect(refused.status).toBe(429);
    expect(((await refused.json()) as { error: string }).error).toBe(
      `Today's research runs for guest portfolios are used up (${GUEST_RUN_LIMIT} of ${GUEST_RUN_LIMIT}). They reset at 00:00 UTC.`,
    );
    const user = await collection(mongo.db, 'users').findOne({ _id: late.user._id });
    expect(user!.investigatedOn).toBeUndefined();
    expect(await budget()).toMatchObject({ runs: 1, guestRuns: GUEST_RUN_LIMIT });
    const item = await collection(mongo.db, 'feed_items').findOne({
      userId: late.user._id,
      eventId,
    });
    expect(item!.research.state).toBe('none');

    // Guests stop where automatic runs stop, so the last 10 stay for the personas' Investigate.
    await collection(mongo.db, 'research_budget').updateOne(
      {},
      { $set: { runs: AUTO_RUN_LIMIT, guestRuns: 1 } },
    );
    const refusedAtShare = await investigate(late.cookie);
    expect(refusedAtShare.status).toBe(429);
    expect(((await refusedAtShare.json()) as { error: string }).error).toBe(
      `Today's research runs for guest portfolios are used up (${AUTO_RUN_LIMIT} of ${AUTO_RUN_LIMIT}). They reset at 00:00 UTC.`,
    );
    const personaB = await signIn(api.url, 'B');
    expect((await investigate(personaB)).status).toBe(202);
  });

  it('never starts automatic research for a guest, and records why', async () => {
    const guest = await createGuest(['TSM']);
    const item = (await collection(mongo.db, 'feed_items').findOne({
      userId: guest.user._id,
      eventId,
    }))!;
    await autoResearch(
      {
        db: mongo.db,
        models: () => research,
        mcp: { url: `${api.url}/mcp`, secret: TEST_MCP_SECRET },
        redact: (text: string) => text,
      },
      eventId,
      [{ item, created: false }],
    );
    const runs = await collection(mongo.db, 'agent_runs')
      .find({ userId: guest.user._id })
      .toArray();
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      status: 'skipped',
      gate: {
        decision: 'skip',
        reason: 'Automatic research does not run for guest portfolios; Investigate runs one a day.',
      },
      expiresAt: guest.user.expiresAt,
    });
    expect(await collection(mongo.db, 'research_budget').countDocuments()).toBe(0);
  });

  it('changes a guest portfolio in place and never a persona', async () => {
    const guest = await createGuest(['NVDA']);
    expect(await feedOf(guest.cookie)).toHaveLength(1);
    const itemId = (await collection(mongo.db, 'feed_items').findOne({
      userId: guest.user._id,
    }))!._id;

    const response = await put('/guest/portfolio', { symbols: ['KO', 'XOM'] }, guest.cookie);
    expect(response.status).toBe(200);
    const changed = PublicUser.parse(revive(await response.json()));
    expect(changed._id).toBe(guest.user._id);
    expect(changed.holdings.map((h) => h.symbol)).toEqual(['KO', 'XOM']);
    expect(changed.expiresAt).toEqual(guest.user.expiresAt);
    expect(await feedOf(guest.cookie)).toEqual([]);
    const item = await collection(mongo.db, 'feed_items').findOne({ userId: guest.user._id });
    expect(item).toMatchObject({ _id: itemId, relevance: 0, path: null });

    expect((await put('/guest/portfolio', { symbols: ['TSM'] }, guest.cookie)).status).toBe(200);
    expect((await feedOf(guest.cookie))[0]!.item.relevance).toBe(1);
    expect((await put('/guest/portfolio', { symbols: [] }, guest.cookie)).status).toBe(400);

    const personaA = await signIn(api.url, 'A');
    expect((await put('/guest/portfolio', { symbols: ['KO'] }, personaA)).status).toBe(403);
    const a = await collection(mongo.db, 'users').findOne({ email: 'persona.a@kesher.example' });
    expect(a!.holdings.map((h) => h.symbol)).toEqual(['NVDA', 'MSFT', 'AMZN']);
    expect(modelClients).toBe(0);
  });

  it('keeps guest cards through a demo reset, and keeps the Replay control for the personas', async () => {
    const guest = await createGuest(['NVDA']);
    const before = await collection(mongo.db, 'feed_items').findOne({ userId: guest.user._id });
    const reset = await post(`/dev/reset/${DEMO_SOURCE_ID}`, {});
    expect(reset.status).toBe(200);
    expect(await collection(mongo.db, 'feed_items').findOne({ userId: guest.user._id })).toEqual(
      before,
    );
    expect(await collection(mongo.db, 'feed_items').countDocuments({ eventId })).toBe(
      await collection(mongo.db, 'users').countDocuments({ expiresAt: { $exists: true } }),
    );
    // The replay scores the personas again and leaves the guest's item where it was.
    const replayed = await post(`/dev/replay/${DEMO_SOURCE_ID}`, {});
    expect(replayed.status).toBe(200);
    await api.idle();
    expect(
      await collection(mongo.db, 'feed_items').findOne({ userId: guest.user._id }),
    ).toMatchObject({ _id: before!._id, createdAt: before!.createdAt });

    // A guest made after the replay sees the card where the personas do: at its new arrival.
    const later = await createGuest(['NVDA']);
    const replayedAt = (await collection(mongo.db, 'feed_items').findOne({
      eventId,
      expiresAt: { $exists: false },
    }))!.createdAt;
    const event = await collection(mongo.db, 'market_events').findOne({ _id: eventId });
    expect(replayedAt.getTime()).toBeGreaterThan(event!.createdAt.getTime());
    expect(
      (await collection(mongo.db, 'feed_items').findOne({ userId: later.user._id, eventId }))!
        .createdAt,
    ).toEqual(replayedAt);
  });

  it(`answers 503 once ${MAX_LIVE_GUESTS} guests are alive`, async () => {
    const users = collection(mongo.db, 'users');
    const live = await users.countDocuments({ expiresAt: { $gt: new Date() } });
    const expiresAt = new Date(Date.now() + GUEST_TTL_MS);
    const fillers = Array.from({ length: MAX_LIVE_GUESTS - live }, (_, i) => ({
      _id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      email: `filler-${i}@guest.invalid`,
      passwordHash: 'none$guest',
      displayName: 'Your portfolio',
      holdings: [{ symbol: 'KO' as const, quantity: 1 }],
      interests: [],
      createdAt: new Date(),
      expiresAt,
    }));
    await users.insertMany(fillers);
    try {
      const response = await post('/guest', { symbols: ['NVDA'] });
      expect(response.status).toBe(503);
    } finally {
      await users.deleteMany({ _id: { $in: fillers.map((f) => f._id) } });
    }
  });
});

describe('guest creation rate limit, on mongod (T24)', () => {
  let mongo: TestMongo;
  let api: TestApi;

  beforeAll(async () => {
    mongo = await startTestMongo('kesher_guest_limit_test');
    await runSeed(mongo.db, eventTime);
    api = await startApi(mongo.db, {
      guest: { createLimit: 2 },
      trustProxy: 1,
      demo: { cooldownMs: 0 },
    });
  }, MONGO_START_TIMEOUT_MS);

  afterAll(async () => {
    await api?.close();
    await mongo?.stop();
  });

  const create = (ip: string) =>
    fetch(`${api.url}/guest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
      body: JSON.stringify({ symbols: ['NVDA'] }),
    });

  it('limits guests per client address behind the proxy', async () => {
    expect((await create('203.0.113.1')).status).toBe(201);
    expect((await create('203.0.113.1')).status).toBe(201);
    const refused = await create('203.0.113.1');
    expect(refused.status).toBe(429);
    expect(Number(refused.headers.get('retry-after'))).toBeGreaterThan(0);
    expect((await create('203.0.113.2')).status).toBe(201);
    expect(
      await collection(mongo.db, 'users').countDocuments({ expiresAt: { $exists: true } }),
    ).toBe(3);
  });

  it('refuses the demo replay to a guest', async () => {
    const created = await create('203.0.113.9');
    expect(created.status).toBe(201);
    const response = await fetch(`${api.url}/demo/replay`, {
      method: 'POST',
      headers: { cookie: sessionCookieOf(created) },
    });
    expect(response.status).toBe(403);
  });
});
