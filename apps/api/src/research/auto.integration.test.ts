import {
  AgentRun,
  DEMO_PERSONAS,
  DEMO_SOURCE_ID,
  FeedCard,
  SOCKET_EVENTS,
  type FeedItem,
  type PersonaKey,
  type Source,
} from '@kesher/shared';
import { io as connect, type Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { collection } from '../db/collections';
import { toIncomingItem } from '../ingest/alpaca';
import { processItem } from '../ingest/process';
import { loadRecording } from '../ingest/recordings';
import { createModelClient, MODELS, type ModelClient } from '../llm/client';
import { loadModelRecording } from '../llm/recordings';
import { runSeed } from '../seed/seed';
import {
  flushPushes,
  recordedModels,
  signIn,
  startApi,
  TEST_MCP_SECRET,
  type TestApi,
} from '../test/api';
import { mockModel, resolveMocks, type ModelReply } from '../test/models';
import { MONGO_START_TIMEOUT_MS, startTestMongo, type TestMongo } from '../test/mongo';
import { autoResearch } from './auto';
import { gateRunReason } from './gate';

const now = new Date('2026-09-29T12:00:00Z');

const revive = (value: unknown) =>
  JSON.parse(JSON.stringify(value), (_key, v: unknown) =>
    typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(v) ? new Date(v) : v,
  ) as unknown;

describe('automatic research through the gate, on mongod', () => {
  let mongo: TestMongo;
  let api: TestApi;
  let eventId: string;
  let demo: Source;
  let models: ModelClient;
  let researchCalls = 0;
  let socket: Socket;
  // What persona A's socket received, in order: the push and the card's research state.
  const pushesA: string[] = [];

  const userId = async (key: PersonaKey) =>
    (await collection(mongo.db, 'users').findOne({
      email: DEMO_PERSONAS.find((p) => p.key === key)!.email,
    }))!._id;
  const itemOf = async (key: PersonaKey) =>
    (await collection(mongo.db, 'feed_items').findOne({ userId: await userId(key), eventId }))!;
  const runsOf = async (key: PersonaKey) =>
    (
      await collection(mongo.db, 'agent_runs')
        .find({ userId: await userId(key), eventId })
        .sort({ createdAt: 1 })
        .toArray()
    ).map((run) => AgentRun.parse(run));
  const budgetRuns = async () =>
    (await collection(mongo.db, 'research_budget').findOne())?.runs ?? 0;

  const post = (path: string) => fetch(`${api.url}${path}`, { method: 'POST' });
  // The web's Replay control: reset the event's cards, then replay the demo item.
  const replay = async () => {
    await post(`/dev/reset/${DEMO_SOURCE_ID}`);
    const response = await post(`/dev/replay/${DEMO_SOURCE_ID}`);
    expect(response.status).toBe(200);
  };

  const settled = async (key: PersonaKey): Promise<FeedItem> => {
    for (let i = 0; i < 500; i += 1) {
      const item = await itemOf(key);
      if (item.research.state !== 'queued' && item.research.state !== 'running') return item;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('research never settled');
  };

  // One run: get_event, then a report quoting the demo item.
  const script = (): ModelReply[] => [
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
  // Two runs, A and B, one after the other in the queue. hold keeps the first call waiting.
  const useModel = (hold?: Promise<void>) => {
    const gemini = mockModel(
      MODELS.research.model,
      [...script(), ...script()],
      undefined,
      (call) => {
        researchCalls += 1;
        return call === 0 ? hold : undefined;
      },
    );
    // Groq answers only the verifier, which supports the one claim.
    const groq = mockModel(MODELS.extraction.model, [
      JSON.stringify({
        verdicts: [{ claim: 'k1', verdict: 'supported', priceCause: false, reason: 'stated' }],
      }),
    ]);
    models = createModelClient({
      resolve: resolveMocks({ [gemini.modelId]: gemini, [groq.modelId]: groq }),
    });
  };

  beforeAll(async () => {
    mongo = await startTestMongo('kesher_auto_research_test');
    await runSeed(mongo.db, now);
    // The first processing extracts the item with its recorded answers, with no gate; every
    // replay after a reset scores it again with no extraction call.
    const result = await processItem(
      mongo.db,
      toIncomingItem((await loadRecording(DEMO_SOURCE_ID))!.item),
      {
        mode: 'replay',
        models: recordedModels((await loadModelRecording(DEMO_SOURCE_ID))!),
        now: () => now,
        log: () => {},
      },
    );
    if (result.outcome !== 'processed') throw new Error('expected processed');
    eventId = result.eventId;
    demo = (await collection(mongo.db, 'sources').findOne({ _id: result.sourceId }))!;
    api = await startApi(mongo.db, { models: () => models, research: true });

    socket = connect(api.url, {
      transports: ['websocket'],
      extraHeaders: { cookie: await signIn(api.url, 'A') },
      reconnection: false,
    });
    await new Promise<void>((resolve) => socket.once('connect', () => resolve()));
    for (const [name, push] of [
      [SOCKET_EVENTS.feedItem, 'item'],
      [SOCKET_EVENTS.feedUpdate, 'update'],
    ] as const) {
      socket.on(name, (card: unknown) => {
        pushesA.push(`${push} ${FeedCard.parse(revive(card)).item.research.state}`);
      });
    }
  }, MONGO_START_TIMEOUT_MS);

  beforeEach(async () => {
    useModel();
    researchCalls = 0;
    pushesA.length = 0;
    for (const name of ['agent_runs', 'reports', 'claims', 'research_budget'] as const) {
      await collection(mongo.db, name).deleteMany({});
    }
  });

  // Every test ends with the queue empty and A's pushes received, so no run or push of one test
  // lands in the next after its reset.
  afterEach(async () => {
    await api.idle();
    await flushPushes(api, socket, await userId('A'));
  });

  afterAll(async () => {
    socket?.close();
    await api?.close();
    await mongo?.stop();
  });

  it('pushes the card before its research completes, then attaches the research', async () => {
    let release!: () => void;
    useModel(new Promise<void>((resolve) => (release = resolve)));

    await replay();
    // The replay has answered and the first run is waiting on its model: A already has its
    // card, and its research has not finished.
    await expect.poll(() => pushesA[0]).toBe('item none');
    expect(['queued', 'running']).toContain((await itemOf('A')).research.state);
    expect(await collection(mongo.db, 'reports').countDocuments()).toBe(0);

    release();
    const [a, b] = [await settled('A'), await settled('B')];
    expect(a.research.state).toBe('done');
    expect(b.research.state).toBe('done');
    await expect
      .poll(() => pushesA)
      .toEqual(['item none', 'update queued', 'update running', 'update done']);
  });

  it('runs auto research for A (0.80) and B (1.00) with the gate reason, and nothing for C', async () => {
    await replay();
    await settled('A');
    await settled('B');

    const [runA] = await runsOf('A');
    expect(runA).toMatchObject({
      mode: 'auto',
      trigger: 'gate',
      status: 'succeeded',
      stepBudget: 6,
      tokenBudget: 16_000,
    });
    expect(runA!.gate.decision).toBe('run');
    const [runB] = await runsOf('B');
    expect(runB).toMatchObject({ mode: 'auto', trigger: 'gate', status: 'succeeded' });
    // The queue runs A and B one after the other; each reason names its place in the budget.
    const reasons = (relevance: number) =>
      [1, 2].map((runs) => gateRunReason({ relevance, importance: 4, runs }));
    expect(reasons(0.8)).toContain(runA!.gate.reason);
    expect(reasons(1)).toContain(runB!.gate.reason);
    const place = (reason: string) => /research run (\d+) today/.exec(reason)?.[1];
    expect([place(runA!.gate.reason), place(runB!.gate.reason)].sort()).toEqual(['1', '2']);
    expect((await itemOf('A')).research.runId).toBe(runA!._id);
    expect(await runsOf('C')).toEqual([]);
    expect((await itemOf('C')).research.state).toBe('none');
    expect(await budgetRuns()).toBe(2);
  });

  it('skips a second replay within 24 hours and attaches the report, with no model call', async () => {
    await replay();
    const first = { A: await settled('A'), B: await settled('B') };
    const calls = researchCalls;
    // The item settles before its done card is pushed; wait for the push before clearing.
    await expect.poll(() => pushesA.at(-1)).toBe('update done');
    pushesA.length = 0;

    await replay();
    for (const key of ['A', 'B'] as const) {
      await expect.poll(async () => (await itemOf(key)).research).toEqual(first[key].research);
      const [, skipped] = await runsOf(key);
      expect(skipped).toMatchObject({
        status: 'skipped',
        trigger: 'gate',
        startedAt: null,
        gate: {
          decision: 'skip',
          reason:
            'Research on this event ran for you less than an hour ago; the gate waits 24 hours. Its report is attached to the card.',
        },
      });
      expect(skipped!.steps.map((s) => s.name)).toEqual(['Gate check']);
    }
    expect(researchCalls).toBe(calls);
    expect(await budgetRuns()).toBe(2);
    await expect.poll(() => pushesA).toEqual(['item none', 'update done']);
  });

  it('skips automatic research once 20 runs are used today, and the card stays without', async () => {
    await collection(mongo.db, 'research_budget').insertOne({
      _id: '00000000-0000-4000-8000-00000000b0d9',
      day: new Date().toISOString().slice(0, 10),
      runs: 20,
      updatedAt: new Date(),
    });
    await replay();
    for (const key of ['A', 'B'] as const) {
      await expect.poll(async () => (await runsOf(key)).length).toBe(1);
      const [skipped] = await runsOf(key);
      expect(skipped!.gate).toEqual({
        decision: 'skip',
        reason:
          'The daily research budget for automatic runs is spent: 20 runs today, automatic runs stop at 20 of 30.',
      });
      expect((await itemOf(key)).research.state).toBe('none');
    }
    expect(researchCalls).toBe(0);
    expect(await budgetRuns()).toBe(20);
    // Investigate still has its 10 runs.
    const response = await fetch(`${api.url}/events/${eventId}/investigate`, {
      method: 'POST',
      headers: { cookie: await signIn(api.url, 'A') },
    });
    expect(response.status).toBe(202);
    expect((await settled('A')).research.state).toBe('done');
    expect(await budgetRuns()).toBe(21);
  });

  it('attaches the report of an earlier run when the newest recent run failed', async () => {
    await replay();
    const first = await settled('A');
    // B's run goes after A's in the queue; the second replay then finds it recent too.
    await settled('B');
    const [done] = await runsOf('A');
    await collection(mongo.db, 'agent_runs').insertOne(
      AgentRun.parse({
        ...done,
        _id: '00000000-0000-4000-8000-00000000fa11',
        steps: [],
        status: 'failed',
        failureReason: 'rate_limited',
        createdAt: new Date(),
      }),
    );
    await replay();
    await expect.poll(async () => (await itemOf('A')).research).toEqual(first.research);
    expect((await runsOf('A')).at(-1)!.gate.reason).toBe(
      'Research on this event ran for you less than an hour ago; the gate waits 24 hours. Its report is attached to the card.',
    );
  });

  it('with AUTO_RESEARCH off, records auto_research_off for every card and calls no model', async () => {
    const off = await startApi(mongo.db, {
      models: () => models,
      research: true,
      autoResearch: false,
    });
    try {
      await fetch(`${off.url}/dev/reset/${DEMO_SOURCE_ID}`, { method: 'POST' });
      const response = await fetch(`${off.url}/dev/replay/${DEMO_SOURCE_ID}`, { method: 'POST' });
      expect(response.status).toBe(200);
      await checkSkipped();
      // Investigate is unchanged: it still runs, through the daily budget.
      const investigate = await fetch(`${off.url}/events/${eventId}/investigate`, {
        method: 'POST',
        headers: { cookie: await signIn(off.url, 'A') },
      });
      expect(investigate.status).toBe(202);
      expect((await settled('A')).research.state).toBe('done');
      expect(await budgetRuns()).toBe(1);
    } finally {
      await off.idle();
      await off.close();
    }
  });

  const checkSkipped = async () => {
    for (const key of ['A', 'B'] as const) {
      const runs = await runsOf(key);
      expect(runs).toHaveLength(1);
      expect(runs[0]).toMatchObject({
        trigger: 'gate',
        mode: 'auto',
        status: 'skipped',
        tokensUsed: 0,
        gate: {
          decision: 'skip',
          reason: 'Automatic research is off on this server (AUTO_RESEARCH=false).',
        },
      });
      expect(JSON.parse(runs[0]!.steps[0]!.output)).toMatchObject({
        decision: 'skip',
        condition: 'auto_research_off',
      });
      expect((await itemOf(key)).research.state).toBe('none');
    }
    expect(await runsOf('C')).toEqual([]);
    expect(researchCalls).toBe(0);
    expect(await budgetRuns()).toBe(0);
  };

  it('skips below relevance 0.6 or importance 4, and writes nothing at relevance 0', async () => {
    await replay();
    await settled('A');
    await settled('B');
    await collection(mongo.db, 'agent_runs').deleteMany({});
    const deps = {
      db: mongo.db,
      models: () => models,
      mcp: { url: `${api.url}/mcp`, secret: TEST_MCP_SECRET },
      redact: (text: string) => text,
    };
    const [a, b, c] = [await itemOf('A'), await itemOf('B'), await itemOf('C')];

    await autoResearch(deps, eventId, [
      {
        item: { ...a, relevance: 0.5, research: { state: 'none', runId: null, reportId: null } },
        created: false,
      },
      { item: c, created: false },
    ]);
    const [low] = await runsOf('A');
    expect(low!.gate).toEqual({
      decision: 'skip',
      reason: 'Relevance 0.50 is below the gate minimum of 0.60.',
    });
    expect(await runsOf('C')).toEqual([]);

    await collection(mongo.db, 'market_events').updateOne(
      { _id: eventId },
      { $set: { 'extraction.importance': 3 } },
    );
    try {
      await autoResearch(deps, eventId, [{ item: b, created: false }]);
    } finally {
      await collection(mongo.db, 'market_events').updateOne(
        { _id: eventId },
        { $set: { 'extraction.importance': 4 } },
      );
    }
    const [minor] = await runsOf('B');
    expect(minor!.gate).toEqual({
      decision: 'skip',
      reason: 'Importance 3 is below the gate minimum of 4.',
    });
    expect(researchCalls).toBe(4);
    expect(await budgetRuns()).toBe(2);
  });

  it('skips a card whose research is already queued or running, from any scored copy', async () => {
    await replay();
    await settled('A');
    await settled('B');
    await collection(mongo.db, 'agent_runs').deleteMany({});
    const other = '00000000-0000-4000-8000-00000000abcd';
    await collection(mongo.db, 'feed_items').updateOne(
      { userId: await userId('A'), eventId },
      {
        $set: {
          research: { state: 'running', runId: other, reportId: null },
          updatedAt: new Date(),
        },
      },
    );
    const deps = {
      db: mongo.db,
      models: () => models,
      mcp: { url: `${api.url}/mcp`, secret: TEST_MCP_SECRET },
      redact: (text: string) => text,
    };
    const running = await itemOf('A');
    // A scored copy that still shows none: the claim on the item refuses a second run.
    const stale = { ...running, research: { state: 'none' as const, runId: null, reportId: null } };
    await autoResearch(deps, eventId, [{ item: stale, created: false }]);
    await autoResearch(deps, eventId, [{ item: running, created: false }]);

    const runs = await runsOf('A');
    expect(runs.map((r) => r.gate)).toEqual([
      { decision: 'skip', reason: 'Research on this event is already queued or running for you.' },
      { decision: 'skip', reason: 'Research on this event is already queued or running for you.' },
    ]);
    expect((await itemOf('A')).research).toEqual({
      state: 'running',
      runId: other,
      reportId: null,
    });
    expect(await budgetRuns()).toBe(2);
  });
});
