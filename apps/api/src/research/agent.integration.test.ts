import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  AgentRun,
  Claim,
  Report,
  Source as SourceSchema,
  type FeedItem,
  type MarketEvent,
  type PriceReaction,
  type Source,
  type User,
} from '@kesher/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { TOOLS } from '@kesher/mcp';
import { createApp } from '../app';
import { collection } from '../db/collections';
import { ensureCollections, ensureIndexes } from '../db/indexes';
import { loadReactionFixture } from '../market/fixture';
import { DEMO_SOURCE_ID } from '../seed/config';
import { createModelClient, MODELS } from '../llm/client';
import type { Clock } from '../llm/limiter';
import { mockModel, rateLimitError, resolveMocks, type ModelReply } from '../test/models';
import { MONGO_START_TIMEOUT_MS, startTestMongo, type TestMongo } from '../test/mongo';
import type { PriceReactions } from '../market/reactions';
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
            figures: [],
          },
          {
            key: 'c2',
            type: 'fact',
            text: 'All TSMC fabs were destroyed.',
            sources: [{ sourceId: demo._id, quote: 'all fabs were destroyed' }],
            premises: [],
            figures: [],
          },
          {
            key: 'c3',
            type: 'inference',
            text: 'NVIDIA supply may be affected if the pause lasts.',
            sources: [],
            premises: ['c1'],
            figures: [],
          },
        ],
        openQuestions: ['How long will the pause last?'],
      },
    },
  ],
};

// The verifier's answer: every claim it is sent is supported.
const verdicts = (...answers: [string, 'supported' | 'unsupported'][]) =>
  JSON.stringify({
    verdicts: answers.map(([claim, verdict]) => ({
      claim,
      verdict,
      priceCause: false,
      reason: `${verdict} by test`,
    })),
  });
// The default report sends c1 as k1 and the inference c3 as k2; c2 was removed by its quote.
const allSupported = verdicts(['k1', 'supported'], ['k2', 'supported']);

const t = (iso: string) => new Date(iso);
// The demo event's open gap (docs/SPIKE.md check 3).
const reaction: PriceReaction = {
  anchor: { kind: 'previous_close', baseTime: t('2024-04-02T20:00:00Z'), tradingDay: '2024-04-03' },
  windows: [{ name: 'open_gap', endsAt: t('2024-04-03T13:30:00Z') }],
  rows: (
    [
      ['TSM', -1.16],
      ['NVDA', -1.07],
      ['SMH', -1],
      ['SPY', -0.22],
    ] as const
  ).map(([symbol, pct]) => ({
    symbol,
    basePrice: 100,
    baseBarTime: t('2024-04-02T19:59:00Z'),
    moves: [{ pct, barTime: t('2024-04-03T13:30:00Z') }],
  })),
  delayed: true,
  complete: true,
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
      // What Groq answers: the verifier, which runs on the research fallback's model.
      verifier?: ModelReply[];
      priceReactions?: PriceReactions;
      onVerifierCall?: () => void;
    } = {},
  ) {
    const gemini = mockModel(MODELS.research.model, replies, options.usage, options.onCall);
    const groq = mockModel(MODELS.extraction.model, options.verifier ?? [allSupported]);
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
          ...(options.priceReactions ? { priceReactions: options.priceReactions } : {}),
        },
        { ...request, ...overrides },
      );
    return { gemini, groq, run };
  }

  const loadRun = async (runId: string) =>
    AgentRun.parse(await collection(mongo.db, 'agent_runs').findOne({ _id: runId }));

  it('runs the tools through MCP and stores a checked and verified report', async () => {
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
      // The research turns only; the verifier counts against its own cap.
      tokensUsed: 2_400,
      verification: { tokenCap: 6_000, tokensUsed: 800 },
      costUsd: 0,
      status: 'succeeded',
    });
    expect(stored.steps.map((s) => `${s.kind}:${s.name}`)).toEqual([
      'code:Gate check',
      'code:Provider picked',
      'code:Run token issued',
      'code:Market data read',
      'code:Code claims',
      'model:Research turn 1',
      'tool:get_event',
      'model:Research turn 2',
      'tool:search_news',
      'model:Research turn 3',
      'check:sources_exist',
      'check:quote_verbatim',
      'check:no_advice',
      'model:Verifier',
      'check:verifier',
    ]);
    expect(stored.steps.find((s) => s.name === 'Verifier')).toMatchObject({
      provider: 'groq',
      model: 'openai/gpt-oss-120b',
    });
    for (const step of stored.steps.filter((s) => s.name.startsWith('Research turn'))) {
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
    const search = stored.steps[8];
    expect(search?.input).toEqual({ query: 'TSMC earthquake', symbols: ['TSM'] });
    expect(JSON.parse(search?.output ?? '')).toMatchObject({
      items: [{ sourceId: demo._id, eventId: event._id }],
    });

    const saved = Report.parse(
      await collection(mongo.db, 'reports').findOne({ runId: outcome.runId }),
    );
    expect(saved._id).toBe(outcome.reportId);
    expect(saved.openQuestions).toEqual(['How long will the pause last?']);
    // This path's edge is not stored and no market data is configured, so code wrote nothing.
    expect(saved.omitted).toEqual([
      { kind: 'path_fact', reason: 'no_evidence' },
      { kind: 'price_metric', reason: 'unavailable' },
    ]);
    const claims = (
      await collection(mongo.db, 'claims').find({ reportId: saved._id }).toArray()
    ).map((c) => Claim.parse(c));
    const byText = new Map(claims.map((c) => [c.text, c]));
    expect(saved.sections).toEqual([{ title: 'Claims', claimIds: claims.map((c) => c._id) }]);
    expect(claims.every((c) => c.origin === 'model')).toBe(true);
    expect(byText.get('TSMC evacuated some fabs after the earthquake.')?.status).toBe('supported');
    expect(byText.get('All TSMC fabs were destroyed.')?.status).toBe('removed');
    expect(byText.get('NVIDIA supply may be affected if the pause lasts.')?.status).toBe(
      'supported',
    );
    expect(byText.get('NVIDIA supply may be affected if the pause lasts.')?.checks).toContainEqual({
      name: 'verifier',
      passed: true,
      detail: null,
    });
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

    // Gate, provider, token, market data and code claims before turn 1; then a model step and a
    // tool step per turn.
    expect(seen).toEqual([5, 7, 9]);
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
    const research = models.filter((s) => s.name !== 'Verifier');
    expect(research).toHaveLength(3);
    expect(research.every((s) => s.provider === 'google')).toBe(true);
    // Groq answered only the verifier.
    expect(groq.doGenerateCalls).toHaveLength(1);
    expect(gemini.doGenerateCalls).toHaveLength(4);
    const names = stored.steps.map((s) => s.name);
    expect(names.slice(5, 8)).toEqual(['Research turn 1', 'get_event', 'Rate limit wait']);
    expect(stored.steps[7]?.input).toEqual({
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
                figures: [],
              },
            ],
            openQuestions: [],
          },
        },
      ],
    });

    const { run, groq } = setup([getEvent, relationships, cite(TSMC_QUOTE)]);
    const kept = await run();
    const keptClaims = await collection(mongo.db, 'claims')
      .find({ reportId: kept.reportId! })
      .toArray();
    expect(keptClaims.map((c) => c.status)).toEqual(['supported']);
    // The verifier reads the filing through the text the tool returned, not a bare title.
    expect(JSON.stringify(groq.doGenerateCalls[0]?.prompt)).toContain(
      'We utilize foundries, such as Taiwan Semiconductor',
    );

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
  it("never shows the verifier the research agent's messages, and removes what it rejects", async () => {
    const reasoning: ModelReply = {
      toolCalls: (report as { toolCalls: { toolName: string; input: unknown }[] }).toolCalls,
      text: 'PRIVATE RESEARCH REASONING',
    };
    const { groq, run } = setup([getEvent, searchNews, reasoning], {
      verifier: [verdicts(['k1', 'unsupported'], ['k2', 'supported'])],
    });

    const outcome = await run();

    const [call] = groq.doGenerateCalls;
    const prompt = JSON.stringify(call?.prompt);
    expect(prompt).not.toContain('PRIVATE RESEARCH REASONING');
    expect(prompt).not.toContain('tool_output');
    expect(prompt).not.toContain('Why it reached this investor');
    expect(call?.tools ?? []).toEqual([]);
    // The claim and its source, as quoted data.
    expect(prompt).toContain('TSMC evacuated some fabs after the earthquake.');
    expect(prompt).toContain('most tools recovered within hours');

    const stored = await loadRun(outcome.runId);
    const claims = await collection(mongo.db, 'claims')
      .find({ reportId: outcome.reportId! })
      .toArray();
    const byText = new Map(claims.map((c) => [c.text, c]));
    const fact = byText.get('TSMC evacuated some fabs after the earthquake.');
    const inference = byText.get('NVIDIA supply may be affected if the pause lasts.');
    expect(fact?.status).toBe('removed');
    expect(inference?.status).toBe('removed');
    expect(stored.steps.map((s) => s.name).slice(-3)).toEqual([
      'Verifier',
      'verifier',
      'premises_supported',
    ]);
    expect(JSON.parse(stored.steps.at(-2)?.output ?? '')).toMatchObject({
      removedClaimIds: [fact?._id],
    });
    expect(JSON.parse(stored.steps.at(-1)?.output ?? '')).toMatchObject({
      removedClaimIds: [inference?._id],
    });
  });

  it('leaves claims unverified and the run succeeded when the verifier call fails', async () => {
    const { run } = setup([getEvent, searchNews, report], {
      verifier: [new Error('the answer did not match the schema')],
    });

    const outcome = await run();

    expect(outcome.status).toBe('succeeded');
    const stored = await loadRun(outcome.runId);
    expect(stored.steps.at(-1)).toMatchObject({ kind: 'code', name: 'Verifier failed' });
    const claims = await collection(mongo.db, 'claims')
      .find({ reportId: outcome.reportId! })
      .toArray();
    expect(claims.map((c) => c.status).sort()).toEqual(['removed', 'unverified', 'unverified']);
  });

  it('checks a metric against the price reaction at the event time and cites the market data', async () => {
    const asked: [readonly string[], Date][] = [];
    const priceReactions: PriceReactions = (subjects, headline) => {
      asked.push([subjects, headline]);
      return Promise.resolve(reaction);
    };
    const metrics: ModelReply = {
      toolCalls: [
        {
          toolName: 'submit_report',
          input: {
            claims: [
              {
                key: 'c1',
                type: 'metric',
                text: 'NVDA opened −1.1% below its previous close; SMH −1.00%, SPY −0.22%.',
                sources: [],
                premises: [],
                figures: [
                  { symbol: 'NVDA', window: 'open_gap', pct: -1.07 },
                  { symbol: 'SMH', window: 'open_gap', pct: -1 },
                  { symbol: 'SPY', window: 'open_gap', pct: -0.22 },
                ],
              },
              {
                key: 'c2',
                type: 'metric',
                text: 'TSM opened −1.61% lower.',
                sources: [],
                premises: [],
                figures: [{ symbol: 'TSM', window: 'open_gap', pct: -1.61 }],
              },
            ],
            openQuestions: ['Should investors sell NVDA?', 'How long did the pause last?'],
          },
        },
      ],
    };
    // k1 is code's price metric, k2 the model's; the wrong one never reaches the verifier.
    const { groq, run } = setup([getEvent, metrics], {
      priceReactions,
      verifier: [verdicts(['k1', 'supported'], ['k2', 'supported'])],
    });

    const outcome = await run();

    // Code reads the reaction once, at the event's own time, for the path's event company and
    // holding; the model's figures name no other symbol, so it is not read again.
    expect(asked).toEqual([[['TSM', 'NVDA'], event.publishedAt]]);
    const claims = await collection(mongo.db, 'claims')
      .find({ reportId: outcome.reportId! })
      .toArray();
    const [code, kept, wrong] = claims;
    expect(code).toMatchObject({ origin: 'code', type: 'metric', status: 'supported' });
    expect(code?.sources).toEqual(kept?.sources);
    expect(kept).toMatchObject({ type: 'metric', status: 'supported' });
    expect(wrong?.status).toBe('removed');
    expect(wrong?.checks).toContainEqual({
      name: 'numbers_match',
      passed: false,
      detail: 'TSM open_gap is -1.16%, not -1.61%',
    });

    const market = SourceSchema.parse(
      await collection(mongo.db, 'sources').findOne({ _id: kept?.sources[0]?.sourceId }),
    );
    expect(market).toMatchObject({
      kind: 'market_data',
      externalId: `sip-bars:${event._id}:TSM,NVDA,SMH,SPY`,
      symbols: ['TSM', 'NVDA', 'SMH', 'SPY'],
      text: null,
    });
    const report = await collection(mongo.db, 'reports').findOne({ _id: outcome.reportId! });
    expect(report?.openQuestions).toEqual(['How long did the pause last?']);

    const stored = await loadRun(outcome.runId);
    expect(stored.steps.map((s) => s.name)).toContain('Market data read');
    expect(
      JSON.parse(stored.steps.find((s) => s.name === 'numbers_match')?.output ?? ''),
    ).toMatchObject({
      removedClaimIds: [wrong?._id],
    });
    expect(
      JSON.parse(stored.steps.find((s) => s.name === 'no_advice')?.output ?? ''),
    ).toMatchObject({
      removedClaimIds: [],
      droppedOpenQuestions: ['Should investors sell NVDA?'],
    });
    // The verifier reads the moves code computed, next to the benchmarks.
    const prompt = JSON.stringify(groq.doGenerateCalls[0]?.prompt);
    expect(prompt).toContain('NVDA, open gap: -1.07%');
    expect(prompt).toContain('SPY, open gap: -0.22%');
  });

  it('leaves a metric unverified and unchecked when there is no market data', async () => {
    const metric: ModelReply = {
      toolCalls: [
        {
          toolName: 'submit_report',
          input: {
            claims: [
              {
                key: 'c1',
                type: 'metric',
                text: 'NVDA opened −1.07% lower.',
                sources: [],
                premises: [],
                figures: [{ symbol: 'NVDA', window: 'open_gap', pct: -1.07 }],
              },
            ],
            openQuestions: [],
          },
        },
      ],
    };
    const { groq, run } = setup([getEvent, metric]);

    const outcome = await run();

    const stored = await loadRun(outcome.runId);
    expect(stored.steps.find((s) => s.name === 'Market data read')?.outputSummary).toBe(
      'Market data is not configured. Metric figures stay unchecked.',
    );
    const claims = await collection(mongo.db, 'claims')
      .find({ reportId: outcome.reportId! })
      .toArray();
    expect(claims.map((c) => c.status)).toEqual(['unverified']);
    expect(groq.doGenerateCalls).toHaveLength(0);
  });

  // The deterministic report core (T20): code writes the path's 10-K fact and the price metric in
  // every report, whatever the model writes.
  describe('code claims', () => {
    // A second persona whose path runs through a stored, reviewed TSM supplier_of NVDA edge.
    const personaA: User = { ...user, _id: randomUUID(), email: 'persona.a2@kesher.example' };
    const supplierEdgeId = randomUUID();
    const pathItem: FeedItem = {
      ...feedItem,
      _id: randomUUID(),
      userId: personaA._id,
      path: {
        eventCompany: 'TSM',
        holding: 'NVDA',
        hops: [
          {
            from: 'TSM',
            to: 'NVDA',
            type: 'supplier_of',
            weight: 0.8,
            relationshipId: supplierEdgeId,
          },
        ],
      },
    };

    beforeAll(async () => {
      await collection(mongo.db, 'users').insertOne(personaA);
      await collection(mongo.db, 'companies').insertOne({
        _id: randomUUID(),
        symbol: 'NVDA',
        primaryListing: 'NVDA',
        name: 'NVIDIA Corporation',
        cik: '0001045810',
        filerType: '10-K',
        sector: 'semiconductors',
        themes: ['ai_accelerators'],
        createdAt: new Date('2026-09-28T00:00:00Z'),
      });
      await collection(mongo.db, 'relationships').insertOne({
        _id: supplierEdgeId,
        from: 'TSM',
        to: 'NVDA',
        type: 'supplier_of',
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
      await collection(mongo.db, 'feed_items').insertOne(pathItem);
    });

    // A model that writes no fact and no metric: one inference on the code claims, and a question.
    const inferenceOnly = (premises: string[]): ModelReply => ({
      toolCalls: [
        {
          toolName: 'submit_report',
          input: {
            claims: [
              {
                key: 'c1',
                type: 'inference',
                text: 'NVIDIA may see wafer supply questions while TSMC recovers.',
                sources: [],
                premises,
                figures: [],
              },
            ],
            openQuestions: ['How long will the recovery take?'],
          },
        },
      ],
    });

    const claimsOf = async (reportId: string | null) =>
      (await collection(mongo.db, 'claims').find({ reportId: reportId! }).toArray()).map((c) =>
        Claim.parse(c),
      );

    it('yields the 10-K fact and the price metric, supported, when the model writes neither', async () => {
      const { gemini, groq, run } = setup([getEvent, inferenceOnly(['e1', 'm1'])], {
        priceReactions: () => Promise.resolve(reaction),
        verifier: [verdicts(['k1', 'supported'], ['k2', 'supported'], ['k3', 'supported'])],
      });

      const outcome = await run({ userId: personaA._id });

      expect(outcome.status).toBe('succeeded');
      const [fact, metric, inference] = await claimsOf(outcome.reportId);
      expect(fact).toMatchObject({
        origin: 'code',
        type: 'fact',
        text: "TSMC supplies NVIDIA, according to NVIDIA's 10-K.",
        status: 'supported',
        sources: [{ sourceId: nvidia10k._id, quote: TSMC_QUOTE }],
      });
      for (const name of ['sources_exist', 'quote_verbatim', 'verifier'] as const) {
        expect(fact?.checks).toContainEqual({ name, passed: true, detail: null });
      }
      expect(metric).toMatchObject({
        origin: 'code',
        type: 'metric',
        text: 'TSM opened −1.16% below its previous close and NVDA opened −1.07% below its previous close; SMH −1.00%, SPY −0.22%.',
        status: 'supported',
      });
      expect(metric?.checks).toContainEqual({ name: 'numbers_match', passed: true, detail: null });
      const market = await collection(mongo.db, 'sources').findOne({
        _id: metric?.sources.at(-1)?.sourceId,
      });
      expect(market?.kind).toBe('market_data');
      expect(inference).toMatchObject({
        origin: 'model',
        status: 'supported',
        premises: [fact?._id, metric?._id],
      });

      const saved = Report.parse(
        await collection(mongo.db, 'reports').findOne({ _id: outcome.reportId! }),
      );
      expect(saved.omitted).toEqual([]);
      expect(saved.sections[0]?.claimIds).toEqual([fact?._id, metric?._id, inference?._id]);

      // The brief lists what code wrote, by key, and never the filing's own words.
      const brief = JSON.stringify(gemini.doGenerateCalls[0]?.prompt);
      expect(brief).toContain("- e1 (fact): TSMC supplies NVIDIA, according to NVIDIA's 10-K.");
      expect(brief).toContain('- m1 (metric): TSM opened −1.16%');
      expect(brief).not.toContain('We utilize foundries');
      // The verifier judged all three in one call, the 10-K quote among its sources.
      expect(groq.doGenerateCalls).toHaveLength(1);
      expect(JSON.stringify(groq.doGenerateCalls[0]?.prompt)).toContain('We utilize foundries');

      const stored = await loadRun(outcome.runId);
      const names = stored.steps.map((s) => s.name);
      expect(names.slice(3, 5)).toEqual(['Market data read', 'Code claims']);
      expect(names.filter((n) => n === 'Market data read')).toHaveLength(1);
      expect(JSON.parse(stored.steps[4]?.output ?? '')).toMatchObject({
        claims: [
          { key: 'e1', type: 'fact', sourceIds: [nvidia10k._id] },
          { key: 'm1', type: 'metric' },
        ],
        omitted: [],
      });
    });

    it('leaves the metric out with its reason while the reaction is pending, and still succeeds', async () => {
      const pending: PriceReaction = {
        ...reaction,
        complete: false,
        rows: reaction.rows.map((row) =>
          row.symbol === 'NVDA' ? { ...row, moves: [{ pct: null, barTime: null }] } : row,
        ),
      };
      const { gemini, run } = setup([getEvent, inferenceOnly(['e1'])], {
        priceReactions: () => Promise.resolve(pending),
        verifier: [verdicts(['k1', 'supported'], ['k2', 'supported'])],
      });

      const outcome = await run({ userId: personaA._id });

      expect(outcome.status).toBe('succeeded');
      const claims = await claimsOf(outcome.reportId);
      expect(claims.map((c) => [c.origin, c.type, c.status])).toEqual([
        ['code', 'fact', 'supported'],
        ['model', 'inference', 'supported'],
      ]);
      const saved = await collection(mongo.db, 'reports').findOne({ _id: outcome.reportId! });
      expect(saved?.omitted).toEqual([{ kind: 'price_metric', reason: 'not_ready' }]);
      expect(JSON.stringify(gemini.doGenerateCalls[0]?.prompt)).toContain(
        'The price reaction is not available yet, so code wrote no price metric.',
      );
    });

    it('leaves the metric out as unavailable when the market data cannot be read', async () => {
      const { run } = setup([getEvent, inferenceOnly(['e1'])], {
        priceReactions: () => Promise.reject(new Error('Alpaca is down')),
        verifier: [verdicts(['k1', 'supported'], ['k2', 'supported'])],
      });

      const outcome = await run({ userId: personaA._id });

      expect(outcome.status).toBe('succeeded');
      const saved = await collection(mongo.db, 'reports').findOne({ _id: outcome.reportId! });
      expect(saved?.omitted).toEqual([{ kind: 'price_metric', reason: 'unavailable' }]);
      expect((await claimsOf(outcome.reportId)).map((c) => c.type)).toEqual(['fact', 'inference']);
    });

    // A model metric on a symbol off the path: AMD, read on its own after the report.
    const amdMetric: ModelReply = {
      toolCalls: [
        {
          toolName: 'submit_report',
          input: {
            claims: [
              {
                key: 'c1',
                type: 'metric',
                text: 'AMD opened −2.50% below its previous close.',
                sources: [],
                premises: [],
                figures: [{ symbol: 'AMD', window: 'open_gap', pct: -2.5 }],
              },
            ],
            openQuestions: [],
          },
        },
      ],
    };
    const amdReaction: PriceReaction = {
      ...reaction,
      rows: [
        {
          ...reaction.rows[0]!,
          symbol: 'AMD',
          moves: [{ pct: -2.5, barTime: t('2024-04-03T13:30:00Z') }],
        },
        ...reaction.rows.filter((row) => row.symbol === 'SMH' || row.symbol === 'SPY'),
      ],
    };

    it('reads a symbol only a model metric names on its own, and checks every metric', async () => {
      const asked: (readonly string[])[] = [];
      const { run } = setup([getEvent, amdMetric], {
        priceReactions: (subjects) => {
          asked.push(subjects);
          return Promise.resolve(subjects.includes('AMD') ? amdReaction : reaction);
        },
        verifier: [verdicts(['k1', 'supported'], ['k2', 'supported'], ['k3', 'supported'])],
      });

      const outcome = await run({ userId: personaA._id });

      expect(asked).toEqual([['TSM', 'NVDA'], ['AMD']]);
      const claims = await claimsOf(outcome.reportId);
      expect(claims.map((c) => [c.origin, c.type, c.status])).toEqual([
        ['code', 'fact', 'supported'],
        ['code', 'metric', 'supported'],
        ['model', 'metric', 'supported'],
      ]);
      for (const metric of claims.filter((c) => c.type === 'metric')) {
        expect(metric.checks).toContainEqual({ name: 'numbers_match', passed: true, detail: null });
      }
      const market = await collection(mongo.db, 'sources').findOne({
        _id: claims[2]?.sources.at(-1)?.sourceId,
      });
      expect(market?.symbols).toEqual(['TSM', 'NVDA', 'AMD', 'SMH', 'SPY']);
    });

    it('leaves that metric unchecked when its symbol cannot be read, and keeps the code metric', async () => {
      const { run } = setup([getEvent, amdMetric], {
        priceReactions: (subjects) =>
          subjects.includes('AMD')
            ? Promise.reject(new Error('Alpaca is down'))
            : Promise.resolve(reaction),
        verifier: [verdicts(['k1', 'supported'], ['k2', 'supported'])],
      });

      const outcome = await run({ userId: personaA._id });

      const [, codeMetric, modelMetric] = await claimsOf(outcome.reportId);
      expect(codeMetric).toMatchObject({ origin: 'code', status: 'supported' });
      expect(codeMetric?.checks).toContainEqual({
        name: 'numbers_match',
        passed: true,
        detail: null,
      });
      expect(modelMetric).toMatchObject({ origin: 'model', status: 'unverified' });
      expect(modelMetric?.checks.map((c) => c.name)).not.toContain('numbers_match');
    });

    it('keeps the report when the model puts source ids in premises, and says what it cost', async () => {
      // As a real run did (T20): source ids in the premises of a fact and of two inferences.
      const sourceIdPremises: ModelReply = {
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
                    {
                      sourceId: demo._id,
                      quote: 'evacuated some fabs after the strongest earthquake',
                    },
                  ],
                  premises: [nvidia10k._id],
                  figures: [],
                },
                {
                  key: 'c2',
                  type: 'inference',
                  text: 'NVIDIA may see wafer supply questions while TSMC recovers.',
                  sources: [],
                  premises: ['e1', demo._id],
                  figures: [],
                },
                {
                  key: 'c3',
                  type: 'inference',
                  text: 'Other foundry customers may be affected.',
                  sources: [],
                  premises: [demo._id],
                  figures: [],
                },
              ],
              openQuestions: [],
            },
          },
        ],
      };
      const { run } = setup([getEvent, sourceIdPremises], {
        priceReactions: () => Promise.resolve(reaction),
        verifier: [verdicts(['k1', 'supported'], ['k2', 'supported'], ['k3', 'supported'])],
      });

      const outcome = await run({ userId: personaA._id });

      expect(outcome.status).toBe('succeeded');
      const claims = await claimsOf(outcome.reportId);
      expect(claims.map((c) => [c.origin, c.type, c.status])).toEqual([
        ['code', 'fact', 'supported'],
        ['code', 'metric', 'supported'],
        ['model', 'fact', 'supported'],
        ['model', 'inference', 'removed'],
      ]);
      const stored = await loadRun(outcome.runId);
      const premises = stored.steps.find((s) => s.name === 'premises_supported');
      expect(premises?.outputSummary).toBe(
        '1 checked, 1 removed. Inferences naming a premise not in the report: 1 removed, 1 dropped.',
      );
      expect(JSON.parse(premises?.output ?? '')).toMatchObject({
        unknownPremise: {
          removed: 1,
          dropped: 1,
          removedClaimIds: [claims[3]?._id],
          droppedKeys: ['c3'],
        },
      });
    });

    it('removes an inference that names a code claim the report does not have', async () => {
      // This path has one hop, so there is an e1 and no e2.
      const { run } = setup([getEvent, inferenceOnly(['e1', 'e2'])], {
        priceReactions: () => Promise.resolve(reaction),
        verifier: [verdicts(['k1', 'supported'], ['k2', 'supported'])],
      });

      const outcome = await run({ userId: personaA._id });

      const inference = (await claimsOf(outcome.reportId)).find((c) => c.origin === 'model');
      expect(inference?.status).toBe('removed');
      expect(inference?.checks).toContainEqual({
        name: 'premises_supported',
        passed: false,
        detail: 'premise e2 is not in the report',
      });
    });
  });
});
