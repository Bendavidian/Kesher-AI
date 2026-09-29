import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  AgentRun,
  Claim,
  priceReactionExternalId,
  priceReactionText,
  Report,
  type FeedItem,
  type MarketEvent,
  type Source,
  type User,
} from '@kesher/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { nameUuid, sourceIdName, TOOLS } from '@kesher/mcp';
import { createApp } from '../app';
import { collection } from '../db/collections';
import { ensureCollections, ensureIndexes } from '../db/indexes';
import { loadReactionFixture } from '../market/fixture';
import { DEMO_SOURCE_ID } from '../seed/config';
import { createModelClient, MODELS } from '../llm/client';
import type { Clock } from '../llm/limiter';
import { mockModel, rateLimitError, resolveMocks, type ModelReply } from '../test/models';
import { MONGO_START_TIMEOUT_MS, startTestMongo, type TestMongo } from '../test/mongo';
import { memorySearch } from '../test/search';
import { runResearch, type ResearchRequest } from './agent';
import { RESEARCH_TOOLS, TOKEN_REFRESH_AFTER_MS } from './mcp';

const SECRET = 'research-secret-that-is-long-enough';

const user: User = {
  _id: randomUUID(),
  email: 'persona.a@kesher.example',
  passwordHash: 'scrypt$test',
  displayName: 'Persona A',
  holdings: [
    { symbol: 'NVDA', quantity: 40 },
    { symbol: 'MSFT', quantity: 10 },
  ],
  interests: ['ai_accelerators'],
  createdAt: new Date('2026-09-28T00:00:00Z'),
};

const BODY =
  'Taiwan Semiconductor Manufacturing Co evacuated some fabs after the strongest earthquake in 25 years. The company said most tools recovered within hours.';

const demo: Source = {
  _id: randomUUID(),
  provider: 'alpaca',
  kind: 'news',
  tier: 2,
  externalId: '38062166',
  url: 'https://example.com/tsmc',
  author: null,
  publisher: 'Benzinga',
  title: 'TSMC Suspends Chip Production After Taiwan Rocked By Strongest Tremor In 25 Years',
  text: BODY,
  symbols: ['TSM', 'NVDA'],
  injectionScreen: { flagged: false, score: 0.01, model: 'prompt-guard', screenedAt: new Date() },
  publishedAt: new Date('2024-04-03T03:57:09Z'),
  createdAt: new Date('2026-09-28T00:00:00Z'),
};

const event: MarketEvent = {
  _id: randomUUID(),
  sourceIds: [demo._id],
  headline: demo.title,
  publishedAt: demo.publishedAt,
  status: 'confirmed',
  extraction: {
    companies: [{ symbol: 'TSM', impact: 'negative' }],
    eventType: 'natural_disaster',
    themes: ['foundry'],
    importance: 4,
    provider: 'groq',
    model: 'openai/gpt-oss-120b',
    extractedAt: new Date('2024-04-03T04:00:00Z'),
  },
  embedding: null,
  createdAt: new Date('2024-04-03T04:00:00Z'),
};

const feedItem: FeedItem = {
  _id: randomUUID(),
  userId: user._id,
  eventId: event._id,
  relevance: 0.8,
  path: {
    eventCompany: 'TSM',
    holding: 'NVDA',
    hops: [
      { from: 'TSM', to: 'NVDA', type: 'supplier_of', weight: 0.8, relationshipId: randomUUID() },
    ],
  },
  confidence: 'medium',
  status: 'confirmed',
  research: { state: 'none', runId: null, reportId: null },
  createdAt: new Date(),
  updatedAt: new Date(),
};

const TSMC_QUOTE =
  'We utilize foundries, such as Taiwan Semiconductor Manufacturing Company Limited, or TSMC, and Samsung Electronics Co., Ltd., or Samsung, to produce our semiconductor wafers.';

// Filing Sources keep text null; their text reaches the agent through tools only.
const nvidia10k: Source = {
  ...demo,
  _id: randomUUID(),
  provider: 'sec_edgar',
  kind: 'filing',
  tier: 1,
  externalId: '0001045810-26-000021',
  url: 'https://www.sec.gov/Archives/edgar/data/1045810/000104581026000021/nvda-20260125.htm',
  publisher: null,
  title: 'NVIDIA 10-K for the fiscal year ended 2026-01-25',
  text: null,
  symbols: ['NVDA'],
  injectionScreen: null,
};

const request: ResearchRequest = {
  userId: user._id,
  eventId: event._id,
  mode: 'deep',
  trigger: 'investigate',
  gateReason: 'Investigate skips the relevance and importance conditions.',
};

// Turns the research model answers with.
const getEvent: ModelReply = {
  toolCalls: [{ toolName: 'get_event', input: { eventId: event._id } }],
};
const searchNews: ModelReply = {
  toolCalls: [{ toolName: 'search_news', input: { query: 'TSMC earthquake', symbols: ['TSM'] } }],
};
const report: ModelReply = {
  toolCalls: [
    {
      toolName: 'submit_report',
      input: {
        claims: [
          {
            key: 'c1',
            type: 'fact',
            text: 'TSMC evacuated some fabs after the earthquake.',
            sources: [
              { sourceId: demo._id, quote: 'evacuated some fabs after the strongest earthquake' },
            ],
            premises: [],
          },
          {
            key: 'c2',
            type: 'fact',
            text: 'All TSMC fabs were destroyed.',
            sources: [{ sourceId: demo._id, quote: 'all fabs were destroyed' }],
            premises: [],
          },
          {
            key: 'c3',
            type: 'inference',
            text: 'NVIDIA supply may be affected if the pause lasts.',
            sources: [],
            premises: ['c1'],
          },
        ],
        openQuestions: ['How long will the pause last?'],
      },
    },
  ],
};

// Waits cost nothing: the model client's clock only moves forward.
function stillClock(start = Date.now()): Clock {
  let now = start;
  return {
    now: () => now,
    sleep: (ms) => {
      now += ms;
      return Promise.resolve();
    },
  };
}

describe('runResearch', () => {
  let mongo: TestMongo;
  let server: Server;
  let mcpUrl: string;

  beforeAll(async () => {
    mongo = await startTestMongo('kesher_research_test');
    await ensureCollections(mongo.db);
    await ensureIndexes(mongo.db);
    await collection(mongo.db, 'users').insertOne(user);
    await collection(mongo.db, 'sources').insertMany([demo, nvidia10k]);
    await collection(mongo.db, 'relationships').insertOne({
      _id: randomUUID(),
      from: 'NVDA',
      to: 'TSM',
      type: 'customer_of',
      weight: 0.8,
      evidence: {
        sourceId: nvidia10k._id,
        quote: TSMC_QUOTE,
        filingDate: '2026-02-25',
        url: nvidia10k.url,
        reviewed: true,
      },
      createdAt: new Date('2026-09-29T00:00:00Z'),
    });
    await collection(mongo.db, 'market_events').insertOne(event);
    await collection(mongo.db, 'feed_items').insertOne(feedItem);
    const { reaction } = await loadReactionFixture(DEMO_SOURCE_ID);
    server = createApp({
      db: mongo.db,
      devRoutes: false,
      mcp: { secret: SECRET },
      search: memorySearch(mongo.db),
      priceReactions: () => Promise.resolve(reaction),
    }).listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    mcpUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
  }, MONGO_START_TIMEOUT_MS);

  afterEach(async () => {
    await collection(mongo.db, 'agent_runs').deleteMany({});
    await collection(mongo.db, 'reports').deleteMany({});
    await collection(mongo.db, 'claims').deleteMany({});
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    await mongo?.stop();
  });

  function setup(
    replies: ModelReply[],
    options: {
      usage?: { input: number; output: number };
      onCall?: (call: number) => Promise<void> | void;
      now?: () => number;
    } = {},
  ) {
    const gemini = mockModel(MODELS.research.model, replies, options.usage, options.onCall);
    const groq = mockModel(MODELS.researchFallback.model, [report]);
    const models = createModelClient({
      resolve: resolveMocks({ [gemini.modelId]: gemini, [groq.modelId]: groq }),
      clock: stillClock(),
    });
    const run = (overrides: Partial<ResearchRequest> = {}) =>
      runResearch(
        {
          db: mongo.db,
          models,
          mcp: { url: mcpUrl, secret: SECRET },
          redact: (text) => text.split(SECRET).join('[REDACTED]'),
          ...(options.now ? { now: options.now } : {}),
        },
        { ...request, ...overrides },
      );
    return { gemini, groq, run };
  }

  const loadRun = async (runId: string) =>
    AgentRun.parse(await collection(mongo.db, 'agent_runs').findOne({ _id: runId }));

  it('runs the tools through MCP and stores a checked report', async () => {
    const { run } = setup([getEvent, searchNews, report]);

    const outcome = await run();

    expect(outcome).toMatchObject({ status: 'succeeded', failureReason: null });
    const stored = await loadRun(outcome.runId);
    expect(stored).toMatchObject({
      userId: user._id,
      eventId: event._id,
      agent: 'research',
      mode: 'deep',
      trigger: 'investigate',
      stepBudget: 15,
      tokenBudget: 32_000,
      tokensUsed: 2_400,
      costUsd: 0,
      status: 'succeeded',
    });
    expect(stored.steps.map((s) => `${s.kind}:${s.name}`)).toEqual([
      'code:Gate check',
      'code:Provider picked',
      'code:Run token issued',
      'model:Research turn 1',
      'tool:get_event',
      'model:Research turn 2',
      'tool:search_news',
      'model:Research turn 3',
      'check:sources_exist',
      'check:quote_verbatim',
    ]);
    for (const step of stored.steps.filter((s) => s.kind === 'model')) {
      expect(step).toMatchObject({
        provider: 'google',
        model: 'gemini-3.5-flash-lite',
        tokens: { input: 500, output: 300, total: 800 },
      });
    }
    const tokenStep = stored.steps[2];
    expect(tokenStep?.input).toEqual({
      agent: 'research',
      tools: [
        'get_my_portfolio',
        'get_event',
        'search_news',
        'search_filings',
        'get_company_relationships',
        'get_price_reaction',
        'get_financial_facts',
      ],
      ttlSeconds: 300,
    });
    const search = stored.steps[6];
    expect(search?.input).toEqual({ query: 'TSMC earthquake', symbols: ['TSM'] });
    expect(JSON.parse(search?.output ?? '')).toMatchObject({
      items: [{ sourceId: demo._id, eventId: event._id }],
    });

    const saved = Report.parse(
      await collection(mongo.db, 'reports').findOne({ runId: outcome.runId }),
    );
    expect(saved._id).toBe(outcome.reportId);
    expect(saved.openQuestions).toEqual(['How long will the pause last?']);
    const claims = (
      await collection(mongo.db, 'claims').find({ reportId: saved._id }).toArray()
    ).map((c) => Claim.parse(c));
    const byText = new Map(claims.map((c) => [c.text, c]));
    expect(saved.sections).toEqual([{ title: 'Claims', claimIds: claims.map((c) => c._id) }]);
    expect(byText.get('TSMC evacuated some fabs after the earthquake.')?.status).toBe('unverified');
    expect(byText.get('All TSMC fabs were destroyed.')?.status).toBe('removed');
    expect(byText.get('NVIDIA supply may be affected if the pause lasts.')?.status).toBe(
      'unverified',
    );
    const quoteCheck = stored.steps.find((s) => s.name === 'quote_verbatim');
    expect(JSON.parse(quoteCheck?.output ?? '')).toMatchObject({
      removedClaimIds: [byText.get('All TSMC fabs were destroyed.')?._id],
    });
  });

  it('writes each step before the next model call', async () => {
    let runId = '';
    const seen: number[] = [];
    const { run } = setup([getEvent, searchNews, report], {
      onCall: async () => {
        const stored = await collection(mongo.db, 'agent_runs').findOne(
          {},
          { sort: { createdAt: -1 } },
        );
        runId = stored?._id ?? '';
        seen.push(stored?.steps.length ?? -1);
      },
    });

    await run();

    // Gate, provider and token before turn 1; then a model step and a tool step per turn.
    expect(seen).toEqual([3, 5, 7]);
    expect(runId).not.toBe('');
  });

  it('shows the model only its scoped tools, never a user id, and tool output as quoted data', async () => {
    const { gemini, run } = setup([getEvent, searchNews, report]);

    await run();

    for (const call of gemini.doGenerateCalls) {
      // What the server serves on the research token, and the local report tool.
      const served = TOOLS.map((tool) => tool.name).filter((name) => RESEARCH_TOOLS.includes(name));
      expect(call.tools?.map((t) => t.name).sort()).toEqual([...served, 'submit_report'].sort());
      const prompt = JSON.stringify(call.prompt);
      expect(prompt).not.toContain(user._id);
      expect(prompt).not.toContain(user.email);
    }
    const second = JSON.stringify(gemini.doGenerateCalls[1]?.prompt);
    expect(second).toContain('<tool_output tool=\\"get_event\\">');
    // The untrusted headline first reaches the model inside get_event's quoted output.
    expect(JSON.stringify(gemini.doGenerateCalls[0]?.prompt)).not.toContain(demo.title);
  });

  it('retries a 429 in the middle of the run on the same provider', async () => {
    const { gemini, groq, run } = setup([getEvent, rateLimitError(2), searchNews, report]);

    const outcome = await run();

    expect(outcome.status).toBe('succeeded');
    const stored = await loadRun(outcome.runId);
    const models = stored.steps.filter((s) => s.kind === 'model');
    expect(models).toHaveLength(3);
    expect(models.every((s) => s.provider === 'google')).toBe(true);
    expect(groq.doGenerateCalls).toHaveLength(0);
    expect(gemini.doGenerateCalls).toHaveLength(4);
    const names = stored.steps.map((s) => s.name);
    expect(names.slice(3, 6)).toEqual(['Research turn 1', 'get_event', 'Rate limit wait']);
    expect(stored.steps[5]?.input).toEqual({
      provider: 'google',
      model: 'gemini-3.5-flash-lite',
      attempt: 1,
    });
  });

  it('fails as rate_limited with a step and no report when a 429 asks for over 30 seconds', async () => {
    const { groq, run } = setup([getEvent, rateLimitError(45), report]);

    const outcome = await run();

    expect(outcome).toMatchObject({
      status: 'failed',
      failureReason: 'rate_limited',
      reportId: null,
    });
    const stored = await loadRun(outcome.runId);
    expect(stored.steps.at(-1)).toMatchObject({
      kind: 'code',
      name: 'Rate limited',
      output: JSON.stringify({ reason: 'wait_too_long', waitMs: 45_000, retries: 0 }),
    });
    expect(stored.finishedAt).not.toBeNull();
    expect(await collection(mongo.db, 'reports').countDocuments()).toBe(0);
    expect(groq.doGenerateCalls).toHaveLength(0);
  });

  it('forces the report once the 15 tool calls are spent', async () => {
    // A query that finds nothing keeps each tool result small, so tokens never bind first.
    const miss: ModelReply = { toolCalls: [{ toolName: 'search_news', input: { query: 'zzz' } }] };
    const { gemini, run } = setup([...Array<ModelReply>(15).fill(miss), report], {
      usage: { input: 100, output: 20 },
    });

    const outcome = await run();

    expect(outcome.status).toBe('succeeded');
    const stored = await loadRun(outcome.runId);
    expect(stored.steps.filter((s) => s.kind === 'tool')).toHaveLength(15);
    expect(stored.steps.find((s) => s.name === 'Report turn')?.input).toMatchObject({
      toolChoice: 'submit_report',
      reason: 'step_budget',
    });
    expect(gemini.doGenerateCalls[15]?.toolChoice).toEqual({
      type: 'tool',
      toolName: 'submit_report',
    });
  });

  it('stores the market_data Source a price reaction names, so a metric citing it stays', async () => {
    const { reaction } = await loadReactionFixture(DEMO_SOURCE_ID);
    const sourceId = nameUuid(sourceIdName('alpaca', priceReactionExternalId(reaction)));
    const price: ModelReply = {
      toolCalls: [
        {
          toolName: 'get_price_reaction',
          input: { symbol: 'TSM', eventTime: '2024-04-03T03:57:09Z' },
        },
      ],
    };
    const metric: ModelReply = {
      toolCalls: [
        {
          toolName: 'submit_report',
          input: {
            claims: [
              {
                key: 'c1',
                type: 'metric',
                text: 'TSM opened 1.16% below the previous close, while SPY also moved.',
                // A line of the text get_price_reaction returned, quoted exactly.
                sources: [{ sourceId, quote: priceReactionText(reaction).split('\n')[1] }],
                premises: [],
              },
            ],
            openQuestions: [],
          },
        },
      ],
    };

    for (const attempt of [1, 2]) {
      const { run } = setup([getEvent, price, metric]);
      const outcome = await run();
      expect(outcome.status, `run ${attempt}`).toBe('succeeded');
      const claims = await collection(mongo.db, 'claims')
        .find({ reportId: outcome.reportId! })
        .toArray();
      expect(claims.map((c) => [c.type, c.status])).toEqual([['metric', 'unverified']]);
    }
    const stored = await collection(mongo.db, 'sources').find({ kind: 'market_data' }).toArray();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ _id: sourceId, provider: 'alpaca', tier: 1 });
    expect(stored[0]?.text).toContain('TSM: base');
  });

  it("keeps a fact quoting the NVIDIA 10-K through a relationship's evidence", async () => {
    const relationships: ModelReply = {
      toolCalls: [{ toolName: 'get_company_relationships', input: { symbol: 'NVDA' } }],
    };
    const cite = (quote: string): ModelReply => ({
      toolCalls: [
        {
          toolName: 'submit_report',
          input: {
            claims: [
              {
                key: 'c1',
                type: 'fact',
                text: "NVIDIA's 10-K names TSMC as a foundry for its wafers.",
                sources: [{ sourceId: nvidia10k._id, quote }],
                premises: [],
              },
            ],
            openQuestions: [],
          },
        },
      ],
    });

    const kept = await setup([getEvent, relationships, cite(TSMC_QUOTE)]).run();
    const keptClaims = await collection(mongo.db, 'claims')
      .find({ reportId: kept.reportId! })
      .toArray();
    expect(keptClaims.map((c) => c.status)).toEqual(['unverified']);

    // The same quote without the tool call that returned it is removed.
    const unread = await setup([getEvent, cite(TSMC_QUOTE)]).run();
    const removed = await collection(mongo.db, 'claims')
      .find({ reportId: unread.reportId! })
      .toArray();
    expect(removed.map((c) => c.status)).toEqual(['removed']);
  });

  it('forces the report early when the token budget binds first', async () => {
    // At 7,300 tokens a turn, the fourth turn must be the report: after three turns only 10,100
    // of 32,000 remain, less than a tool turn and a report after it with the seven tool schemas.
    const { run } = setup([getEvent, searchNews, searchNews, report], {
      usage: { input: 7_000, output: 300 },
    });

    const outcome = await run();

    expect(outcome.status).toBe('succeeded');
    const stored = await loadRun(outcome.runId);
    expect(stored.steps.filter((s) => s.kind === 'tool')).toHaveLength(3);
    expect(stored.steps.find((s) => s.name === 'Report turn')?.input).toMatchObject({
      reason: 'token_budget',
    });
    expect(stored.tokensUsed).toBe(4 * 7_300);
  });

  it('counts a report turn that calls another tool as a failed attempt, and runs nothing', async () => {
    // The skipped report turn is charged its estimate and output cap; a second report still fits.
    // Three tool turns of 7,300 leave 10,100: the fourth turn must report, and a report still
    // fits after the rejected one, which costs 3,300.
    const rejected: ModelReply = { ...searchNews, usage: { input: 3_000, output: 300 } };
    const { run } = setup([getEvent, searchNews, searchNews, rejected, report], {
      usage: { input: 7_000, output: 300 },
    });

    const outcome = await run();

    const stored = await loadRun(outcome.runId);
    expect(outcome.status).toBe('succeeded');
    expect(stored.steps.filter((s) => s.kind === 'tool')).toHaveLength(3);
    expect(stored.steps.filter((s) => s.name === 'Report rejected')).toHaveLength(1);
    expect(stored.steps.filter((s) => s.name === 'Report turn')).toHaveLength(2);
  });

  it('ends as budget_exhausted without a report when no report fits', async () => {
    const { run } = setup([getEvent, report], { usage: { input: 31_000, output: 500 } });

    const outcome = await run();

    expect(outcome).toMatchObject({
      status: 'budget_exhausted',
      failureReason: null,
      reportId: null,
    });
    const stored = await loadRun(outcome.runId);
    expect(stored.steps.at(-1)?.name).toBe('Budget spent');
    expect(await collection(mongo.db, 'reports').countDocuments()).toBe(0);
  });

  it('refreshes the run token before a call once it is 4 minutes old, as a step with the same scope', async () => {
    let offset = -(TOKEN_REFRESH_AFTER_MS + 10_000);
    const { run } = setup([getEvent, searchNews, report], {
      now: () => Date.now() + offset,
      onCall: (call) => {
        // After the first tool call, time catches up: the token is now over 4 minutes old.
        if (call === 1) offset = 0;
      },
    });

    const outcome = await run();

    expect(outcome.status).toBe('succeeded');
    const stored = await loadRun(outcome.runId);
    const names = stored.steps.map((s) => s.name);
    expect(names.filter((n) => n.startsWith('Run token'))).toEqual([
      'Run token issued',
      'Run token refreshed',
    ]);
    const refreshed = stored.steps.find((s) => s.name === 'Run token refreshed');
    expect(refreshed?.input).toEqual({
      agent: 'research',
      tools: [
        'get_my_portfolio',
        'get_event',
        'search_news',
        'search_filings',
        'get_company_relationships',
        'get_price_reaction',
        'get_financial_facts',
      ],
      ttlSeconds: 300,
    });
    // The refresh comes right before the search, which still succeeds on the new token.
    expect(names.indexOf('Run token refreshed')).toBe(names.indexOf('search_news') - 1);
    expect(stored.steps.find((s) => s.name === 'search_news')?.outputSummary).toBe('1 items.');
  });

  it('never sends a tool the token does not list to MCP, and names it only in the input', async () => {
    // A V2 tool that no token lists and the server does not serve.
    const xPosts: ModelReply = { toolCalls: [{ toolName: 'search_x_posts', input: {} }] };
    const { run } = setup([xPosts, report]);

    const outcome = await run();

    expect(outcome.status).toBe('succeeded');
    const stored = await loadRun(outcome.runId);
    const step = stored.steps.find((s) => s.kind === 'tool');
    expect(step).toMatchObject({
      name: 'unknown_tool',
      input: { toolName: 'search_x_posts' },
      outputSummary: 'Not run: the run token lists no such tool.',
    });
  });

  it('retries an invalid report once, then fails as invalid_report', async () => {
    const bad: ModelReply = {
      toolCalls: [{ toolName: 'submit_report', input: { claims: [], openQuestions: [] } }],
    };
    const { run } = setup([getEvent, bad, bad]);

    const outcome = await run();

    expect(outcome).toMatchObject({ status: 'failed', failureReason: 'invalid_report' });
    const stored = await loadRun(outcome.runId);
    expect(stored.steps.filter((s) => s.name === 'Report rejected')).toHaveLength(2);
  });

  it('refuses a request with no path to the user, writing nothing', async () => {
    const { run } = setup([report]);
    await expect(run({ eventId: randomUUID() })).rejects.toThrow('unknown user or event');
    expect(await collection(mongo.db, 'agent_runs').countDocuments()).toBe(0);
  });
});
