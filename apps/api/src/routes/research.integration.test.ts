import {
  AgentRun,
  DEMO_PERSONAS,
  DEMO_SOURCE_ID,
  FeedCard,
  normalizeText,
  ReportDetail,
  SOCKET_EVENTS,
  type FeedItem,
  type PersonaKey,
  type Source,
} from '@kesher/shared';
import { io as connect, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { collection } from '../db/collections';
import { toIncomingItem } from '../ingest/alpaca';
import { processItem } from '../ingest/process';
import { loadRecording } from '../ingest/recordings';
import { createModelClient, MODELS, type ModelClient } from '../llm/client';
import { loadModelRecording } from '../llm/recordings';
import { STALE_RESEARCH_MS, startInvestigation } from '../research/investigate';
import { runSeed } from '../seed/seed';
import { recordedModels, signIn, startApi, TEST_MCP_SECRET, type TestApi } from '../test/api';
import { mockModel, resolveMocks, type ModelReply } from '../test/models';
import { MONGO_START_TIMEOUT_MS, startTestMongo, type TestMongo } from '../test/mongo';

const now = new Date('2026-09-29T12:00:00Z');

const revive = (value: unknown) =>
  JSON.parse(JSON.stringify(value), (_key, v: unknown) =>
    typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(v) ? new Date(v) : v,
  ) as unknown;

describe('POST /events/:eventId/investigate and GET /reports/:reportId, on mongod', () => {
  let mongo: TestMongo;
  let api: TestApi;
  let eventId: string;
  let demo: Source;
  // The research model client of the next run; each test scripts its own.
  let research: ModelClient;
  const cookies = {} as Record<PersonaKey, string>;
  const sockets: Socket[] = [];
  const updates = { A: [] as FeedCard[], B: [] as FeedCard[] };

  const userId = async (key: PersonaKey) =>
    (await collection(mongo.db, 'users').findOne({
      email: DEMO_PERSONAS.find((p) => p.key === key)!.email,
    }))!._id;
  const itemOf = async (key: PersonaKey) =>
    (await collection(mongo.db, 'feed_items').findOne({ userId: await userId(key), eventId }))!;

  const investigate = (cookie: string | undefined, id = eventId) =>
    fetch(`${api.url}/events/${id}/investigate`, {
      method: 'POST',
      ...(cookie ? { headers: { cookie } } : {}),
    });
  const report = (cookie: string, id: string) =>
    fetch(`${api.url}/reports/${id}`, { headers: { cookie } });

  // Waits until the user's item left queued and running, as the background run settles it.
  const settled = async (key: PersonaKey): Promise<FeedItem> => {
    for (let i = 0; i < 500; i += 1) {
      const item = await itemOf(key);
      if (item.research.state !== 'queued' && item.research.state !== 'running') return item;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('research never settled');
  };

  // The research model: get_event, then a report with one verbatim quote and one made up.
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
              },
              {
                key: 'c2',
                type: 'fact',
                text: 'Every TSMC fab was destroyed.',
                sources: [{ sourceId: demo._id, quote: 'every single fab was destroyed' }],
                premises: [],
              },
            ],
            openQuestions: ['How long will the pause last?'],
          },
        },
      ],
    },
  ];
  const useModel = (replies: ModelReply[], onCall?: (call: number) => Promise<void> | void) => {
    const gemini = mockModel(MODELS.research.model, replies, undefined, onCall);
    const groq = mockModel(MODELS.researchFallback.model, [new Error('Groq is not used')]);
    research = createModelClient({
      resolve: resolveMocks({ [gemini.modelId]: gemini, [groq.modelId]: groq }),
    });
  };
  // A model that waits for release before its first answer, so a run stays running.
  const heldModel = () => {
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    useModel(script(), (call) => (call === 0 ? released : undefined));
    return release;
  };

  beforeAll(async () => {
    mongo = await startTestMongo('kesher_research_route_test');
    await runSeed(mongo.db, now);
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
    api = await startApi(mongo.db, { models: () => research, research: true });
    for (const key of ['A', 'B', 'C'] as const) cookies[key] = await signIn(api.url, key);
    for (const key of ['A', 'B'] as const) {
      const socket = connect(api.url, {
        transports: ['websocket'],
        extraHeaders: { cookie: cookies[key] },
        reconnection: false,
      });
      await new Promise<void>((resolve) => socket.once('connect', () => resolve()));
      socket.on(SOCKET_EVENTS.feedUpdate, (card: unknown) =>
        updates[key].push(FeedCard.parse(revive(card))),
      );
      sockets.push(socket);
    }
  }, MONGO_START_TIMEOUT_MS);

  beforeEach(async () => {
    useModel(script());
    updates.A.length = 0;
    updates.B.length = 0;
    await collection(mongo.db, 'feed_items').updateMany(
      { eventId },
      { $set: { research: { state: 'none', runId: null, reportId: null } } },
    );
    await collection(mongo.db, 'research_budget').deleteMany({});
  });

  afterAll(async () => {
    for (const socket of sockets) socket.close();
    await api?.close();
    await mongo?.stop();
  });

  it('answers 401 without a session and 400 for an id that is not an event id', async () => {
    expect((await investigate(undefined)).status).toBe(401);
    expect((await investigate(cookies.A, 'tsmc')).status).toBe(400);
    expect((await report(cookies.A, 'tsmc')).status).toBe(400);
  });

  it('answers 404 and starts nothing for an event not in the feed, or unknown', async () => {
    expect((await investigate(cookies.C)).status).toBe(404);
    expect((await investigate(cookies.A, '00000000-0000-4000-8000-000000000000')).status).toBe(404);
    expect(
      await collection(mongo.db, 'agent_runs').countDocuments({ userId: await userId('C') }),
    ).toBe(0);
    expect((await itemOf('C')).research.state).toBe('none');
  });

  it('answers 202 with the queued card, then pushes running and the done card with its report', async () => {
    const response = await investigate(cookies.A);
    expect(response.status).toBe(202);
    const card = FeedCard.parse(revive(await response.json()));
    expect(card.item.userId).toBe(await userId('A'));
    expect(card.item.research).toMatchObject({ state: 'queued', reportId: null });
    const runId = card.item.research.runId;
    expect(runId).not.toBeNull();

    const item = await settled('A');
    expect(item.research).toMatchObject({ state: 'done', runId });

    await expect
      .poll(() => updates.A.map((c) => c.item.research.state))
      .toEqual(['queued', 'running', 'done']);
    expect(updates.A.map((c) => c.item.research.runId)).toEqual([runId, runId, runId]);
    expect(updates.A[2]!.item.research.reportId).toBe(item.research.reportId);
    expect(updates.B).toEqual([]);

    const run = AgentRun.parse(await collection(mongo.db, 'agent_runs').findOne({ _id: runId! }));
    expect(run).toMatchObject({
      userId: await userId('A'),
      eventId,
      mode: 'deep',
      trigger: 'investigate',
      status: 'succeeded',
      gate: {
        decision: 'run',
        reason:
          'Investigate skips the relevance and importance conditions, not the daily budget: research run 1 of 30 today.',
      },
    });
    expect(await collection(mongo.db, 'research_budget').findOne()).toMatchObject({ runs: 1 });
  });

  it('answers 429 once the daily budget is spent, and changes nothing', async () => {
    await collection(mongo.db, 'research_budget').insertOne({
      _id: '00000000-0000-4000-8000-00000000b0d9',
      day: new Date().toISOString().slice(0, 10),
      runs: 30,
      updatedAt: new Date(),
    });
    const runsBefore = await collection(mongo.db, 'agent_runs').countDocuments();
    const itemBefore = await itemOf('A');

    const response = await investigate(cookies.A);
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({
      error: "Today's research budget is spent (30 of 30 runs). It resets at 00:00 UTC.",
    });
    expect(await itemOf('A')).toEqual(itemBefore);
    expect(await collection(mongo.db, 'agent_runs').countDocuments()).toBe(runsBefore);
    expect(await collection(mongo.db, 'research_budget').findOne()).toMatchObject({ runs: 30 });
    expect(updates.A).toEqual([]);
  });

  it('returns a report in which every kept fact cites a source with a verified quote', async () => {
    await investigate(cookies.A);
    const { research } = await settled('A');
    const response = await report(cookies.A, research.reportId!);
    expect(response.status).toBe(200);
    const detail = ReportDetail.parse(revive(await response.json()));

    expect(detail.run._id).toBe(research.runId);
    expect(detail.card?.item.research).toEqual(research);
    const kept = detail.claims.filter((c) => c.status !== 'removed');
    const removed = detail.claims.filter((c) => c.status === 'removed');
    expect(kept.map((c) => c.text)).toEqual(['TSMC paused some production after the earthquake.']);
    expect(removed.map((c) => c.text)).toEqual(['Every TSMC fab was destroyed.']);
    for (const claim of kept.filter((c) => c.type === 'fact')) {
      expect(claim.sources.length).toBeGreaterThan(0);
      for (const cited of claim.sources) {
        const source = await collection(mongo.db, 'sources').findOne({ _id: cited.sourceId });
        expect(normalizeText(source!.text!)).toContain(normalizeText(cited.quote));
      }
      expect(claim.checks).toContainEqual(
        expect.objectContaining({ name: 'quote_verbatim', passed: true }),
      );
    }
    expect(detail.sources).toEqual([
      {
        _id: demo._id,
        kind: 'news',
        tier: demo.tier,
        title: 'Benzinga via Alpaca',
        citeLabel: 'Benzinga headline',
        ref: `id ${DEMO_SOURCE_ID}`,
      },
    ]);
    // The body text stays on the server; only the quoted words travel.
    expect(JSON.stringify(detail)).not.toContain(demo.text!.slice(-80));
  });

  it('shows a report only to its own user', async () => {
    await investigate(cookies.A);
    const { research } = await settled('A');
    expect((await report(cookies.B, research.reportId!)).status).toBe(404);
    expect((await report(cookies.A, '00000000-0000-4000-8000-000000000000')).status).toBe(404);
  });

  it('answers 409 while a run is going, and starts one run for two requests', async () => {
    const release = heldModel();
    const answers = await Promise.all([investigate(cookies.A), investigate(cookies.A)]);
    expect(answers.map((r) => r.status).sort()).toEqual([202, 409]);
    expect((await investigate(cookies.A)).status).toBe(409);
    release();
    await settled('A');
    expect(
      await collection(mongo.db, 'agent_runs').countDocuments({
        _id: (await itemOf('A')).research.runId!,
      }),
    ).toBe(1);
  });

  it('starts again after a done run, with a new run id', async () => {
    await investigate(cookies.B);
    const first = await settled('B');
    useModel(script());
    expect((await investigate(cookies.B)).status).toBe(202);
    const second = await settled('B');
    expect(second.research.state).toBe('done');
    expect(second.research.runId).not.toBe(first.research.runId);
    expect(second.research.reportId).not.toBe(first.research.reportId);
  });

  it('marks the item failed with its run when the run fails, and pushes it', async () => {
    useModel([new Error('the provider broke')]);
    expect((await investigate(cookies.A)).status).toBe(202);
    const item = await settled('A');
    expect(item.research).toMatchObject({ state: 'failed', reportId: null });
    const run = await collection(mongo.db, 'agent_runs').findOne({ _id: item.research.runId! });
    expect(run).toMatchObject({ status: 'failed', failureReason: 'error' });
    await expect.poll(() => updates.A.at(-1)?.item.research.state).toBe('failed');
  });

  it('takes over a run left running past the stale limit, as after a restart', async () => {
    const lost = '00000000-0000-4000-8000-00000000abcd';
    await collection(mongo.db, 'feed_items').updateOne(
      { userId: await userId('B'), eventId },
      {
        $set: {
          research: { state: 'running', runId: lost, reportId: null },
          updatedAt: new Date(Date.now() - STALE_RESEARCH_MS - 1000),
        },
      },
    );
    expect((await investigate(cookies.B)).status).toBe(202);
    const item = await settled('B');
    expect(item.research.state).toBe('done');
    expect(item.research.runId).not.toBe(lost);
  });

  it('still runs and settles when a feed:update push fails', async () => {
    const errors: unknown[] = [];
    const start = await startInvestigation(
      {
        db: mongo.db,
        models: () => research,
        mcp: { url: `${api.url}/mcp`, secret: TEST_MCP_SECRET },
        redact: (text) => text,
        onResearch: () => {
          throw new Error('the socket broke');
        },
        logError: (error) => errors.push(error),
      },
      await userId('A'),
      eventId,
    );
    if (start.outcome !== 'started') throw new Error('expected started');
    await start.done;
    expect((await itemOf('A')).research.state).toBe('done');
    // queued, running and done: every push failed, and the run still settled.
    expect(errors).toHaveLength(3);
  });
});
