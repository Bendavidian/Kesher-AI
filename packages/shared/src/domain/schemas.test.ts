import { describe, expect, it } from 'vitest';
import { FeedItem, MarketEvent } from './event';
import { FilingChunk } from './filing';
import { IngestCounter } from './ingest';
import { AgentRun, Claim, MAX_STEP_OUTPUT_BYTES, ResearchBudgetDay } from './research';
import { Source } from './source';
import { User } from './user';

const at = new Date('2026-09-28T00:00:00Z');
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const vector = (length: number) => new Array<number>(length).fill(0.01);

describe('User', () => {
  const user = {
    _id: id(1),
    email: 'persona.a@kesher.demo',
    passwordHash: 'scrypt$16384$8$1$c2FsdA$aGFzaA',
    displayName: 'Persona A',
    holdings: [
      { symbol: 'NVDA', quantity: 100 },
      { symbol: 'MSFT', quantity: 50 },
    ],
    interests: ['ai_accelerators'],
    createdAt: at,
  };

  it('accepts a persona with universe holdings', () => {
    expect(User.parse(user)).toEqual(user);
  });

  it('rejects a duplicate holding symbol', () => {
    const holdings = [...user.holdings, { symbol: 'NVDA', quantity: 1 }];
    expect(User.safeParse({ ...user, holdings }).success).toBe(false);
  });

  it('rejects benchmarks, companies outside the universe and empty positions', () => {
    for (const holding of [
      { symbol: 'SPY', quantity: 1 },
      { symbol: 'AAPL', quantity: 1 },
      { symbol: 'NVDA', quantity: 0 },
    ]) {
      expect(User.safeParse({ ...user, holdings: [holding] }).success).toBe(false);
    }
  });

  it('requires a lower case email', () => {
    expect(User.safeParse({ ...user, email: 'Persona.A@kesher.demo' }).success).toBe(false);
  });
});

describe('Source', () => {
  const source = {
    _id: id(2),
    provider: 'sec_edgar',
    kind: 'filing',
    tier: 1,
    externalId: '0001045810-26-000021',
    url: 'https://www.sec.gov/Archives/edgar/data/1045810/000104581026000021/nvda-20260125.htm',
    author: null,
    publisher: null,
    title: 'NVIDIA Corp 10-K for the fiscal year ended 25 Jan 2026',
    text: null,
    symbols: ['NVDA'],
    publishedAt: at,
    injectionScreen: null,
    createdAt: at,
  };

  it('accepts a source that was not screened', () => {
    expect(Source.parse(source)).toEqual(source);
  });

  it('stores the classifier score next to the flag, nullable', () => {
    const screen = { flagged: false, score: 0.02, model: 'prompt-guard', screenedAt: at };
    expect(Source.safeParse({ ...source, injectionScreen: screen }).success).toBe(true);
    const noScore = { ...screen, score: null };
    expect(Source.safeParse({ ...source, injectionScreen: noScore }).success).toBe(true);
    const outOfRange = { ...screen, score: 1.5 };
    expect(Source.safeParse({ ...source, injectionScreen: outOfRange }).success).toBe(false);
  });

  it('keeps the body text, nullable but never blank', () => {
    expect(
      Source.safeParse({ ...source, text: 'Taiwan was struck by an earthquake.' }).success,
    ).toBe(true);
    expect(Source.safeParse({ ...source, text: '  ' }).success).toBe(false);
    expect(Source.safeParse({ ...source, text: undefined }).success).toBe(false);
  });

  it('names the publisher, nullable but never blank or missing', () => {
    expect(Source.safeParse({ ...source, publisher: 'Benzinga' }).success).toBe(true);
    expect(Source.safeParse({ ...source, publisher: ' ' }).success).toBe(false);
    expect(Source.safeParse({ ...source, publisher: undefined }).success).toBe(false);
  });

  it('rejects unknown keys', () => {
    expect(Source.safeParse({ ...source, body: 'text' }).success).toBe(false);
  });
});

describe('MarketEvent', () => {
  const event = {
    _id: id(3),
    sourceIds: [id(2)],
    headline: 'TSMC Suspends Chip Production After Taiwan Rocked By Strongest Tremor In 25 Years',
    publishedAt: at,
    status: 'confirmed',
    extraction: null,
    embedding: null,
    createdAt: at,
  };

  it('accepts an event before extraction and embedding', () => {
    expect(MarketEvent.parse(event)).toEqual(event);
  });

  it('requires at least one source', () => {
    expect(MarketEvent.safeParse({ ...event, sourceIds: [] }).success).toBe(false);
  });

  it('rejects an importance outside 1 to 5 and a wrong embedding length', () => {
    const extraction = {
      companies: [{ symbol: 'TSM', impact: 'negative' }],
      eventType: 'natural_disaster',
      themes: ['foundry'],
      importance: 4,
      provider: 'groq',
      model: 'openai/gpt-oss-120b',
      extractedAt: at,
    };
    expect(MarketEvent.safeParse({ ...event, extraction }).success).toBe(true);
    const tooImportant = { ...extraction, importance: 6 };
    expect(MarketEvent.safeParse({ ...event, extraction: tooImportant }).success).toBe(false);
    expect(MarketEvent.safeParse({ ...event, embedding: vector(383) }).success).toBe(false);
  });
});

describe('FeedItem', () => {
  const hop = (from: string, to: string, type: string, n: number) => ({
    from,
    to,
    type,
    weight: 0.8,
    relationshipId: id(n),
  });
  const item = {
    _id: id(4),
    userId: id(1),
    eventId: id(3),
    relevance: 0.8,
    path: { eventCompany: 'TSM', holding: 'NVDA', hops: [hop('TSM', 'NVDA', 'supplier_of', 10)] },
    confidence: 'medium',
    status: 'confirmed',
    research: { state: 'none', runId: null, reportId: null },
    createdAt: at,
    updatedAt: at,
  };

  it('accepts a supplier path and a direct holding', () => {
    expect(FeedItem.parse(item)).toEqual(item);
    const direct = { eventCompany: 'TSM', holding: 'TSM', hops: [] };
    expect(FeedItem.safeParse({ ...item, relevance: 1, path: direct }).success).toBe(true);
  });

  it('rejects more than 2 hops', () => {
    const hops = [
      hop('TSM', 'NVDA', 'supplier_of', 10),
      hop('NVDA', 'AMD', 'competitor_of', 11),
      hop('AMD', 'INTC', 'competitor_of', 12),
    ];
    const path = { eventCompany: 'TSM', holding: 'INTC', hops };
    expect(FeedItem.safeParse({ ...item, path }).success).toBe(false);
  });

  it('rejects hops that do not lead from the event company to the holding', () => {
    const path = { ...item.path, holding: 'MSFT' };
    expect(FeedItem.safeParse({ ...item, path }).success).toBe(false);
  });

  it('rejects a relevance above 1', () => {
    expect(FeedItem.safeParse({ ...item, relevance: 1.2 }).success).toBe(false);
  });

  it('has no path exactly when relevance is 0', () => {
    expect(FeedItem.safeParse({ ...item, relevance: 0, path: null }).success).toBe(true);
    expect(FeedItem.safeParse({ ...item, path: null }).success).toBe(false);
    expect(FeedItem.safeParse({ ...item, relevance: 0 }).success).toBe(false);
  });

  it('has a report exactly when research is done, and done names its run', () => {
    const research = (state: string, runId: string | null, reportId: string | null) =>
      FeedItem.safeParse({ ...item, research: { state, runId, reportId } }).success;
    expect(research('running', null, null)).toBe(true);
    expect(research('done', id(5), id(6))).toBe(true);
    expect(research('failed', id(5), null)).toBe(true);
    expect(research('failed', null, null)).toBe(true);
    expect(research('done', id(5), null)).toBe(false);
    expect(research('done', null, id(6))).toBe(false);
    expect(research('failed', id(5), id(6))).toBe(false);
  });

  it('rejects research without reportId, as older documents stored it', () => {
    const research = { state: 'none', runId: null };
    expect(FeedItem.safeParse({ ...item, research }).success).toBe(false);
  });
});

describe('AgentRun', () => {
  const step = {
    kind: 'tool',
    name: 'search_filings',
    input: { symbol: 'NVDA', query: 'foundry dependency' },
    outputSummary: '3 chunks',
    output: '{"chunks":3}',
    outputTruncated: false,
    latencyMs: 120,
    startedAt: at,
  };
  const run = {
    _id: id(5),
    userId: id(1),
    eventId: id(3),
    agent: 'research',
    mode: 'auto',
    trigger: 'investigate',
    gate: { decision: 'run', reason: 'investigate skips relevance and importance; budget left' },
    stepBudget: 6,
    tokenBudget: 6000,
    steps: [step],
    tokensUsed: 0,
    verification: null,
    costUsd: 0,
    status: 'running',
    failureReason: null,
    startedAt: at,
    finishedAt: null,
    createdAt: at,
  };

  it('accepts a tool step', () => {
    expect(AgentRun.parse(run)).toEqual(run);
  });

  it('caps step output at 8 KB of UTF-8, not 8,192 characters', () => {
    const full = 'x'.repeat(MAX_STEP_OUTPUT_BYTES);
    expect(AgentRun.safeParse({ ...run, steps: [{ ...step, output: full }] }).success).toBe(true);
    const over = { ...step, output: `${'x'.repeat(MAX_STEP_OUTPUT_BYTES - 1)}é` };
    expect(AgentRun.safeParse({ ...run, steps: [over] }).success).toBe(false);
  });

  it('names a failure reason exactly when the run failed', () => {
    const failed = { ...run, status: 'failed', failureReason: 'rate_limited' };
    expect(AgentRun.safeParse(failed).success).toBe(true);
    expect(AgentRun.safeParse({ ...failed, failureReason: null }).success).toBe(false);
    expect(AgentRun.safeParse({ ...run, failureReason: 'rate_limited' }).success).toBe(false);
  });

  it('requires provider, model and tokens on a model step', () => {
    const modelStep = {
      ...step,
      kind: 'model',
      name: 'plan',
      provider: 'google',
      model: 'gemini-3.5-flash-lite',
      tokens: { input: 500, output: 100, total: 600 },
    };
    expect(AgentRun.safeParse({ ...run, steps: [modelStep] }).success).toBe(true);
    const withoutTokens = { ...modelStep, tokens: undefined };
    expect(AgentRun.safeParse({ ...run, steps: [withoutTokens] }).success).toBe(false);
  });
});

describe('Claim', () => {
  const base = {
    _id: id(6),
    reportId: id(7),
    text: 'NVIDIA uses TSMC to produce its semiconductor wafers.',
    status: 'unverified',
    checks: [],
    createdAt: at,
  };
  const quoted = { sourceId: id(2), quote: 'We utilize foundries, such as TSMC' };

  it('requires a fact to cite at least one source with a quote', () => {
    expect(
      Claim.safeParse({ ...base, type: 'fact', sources: [quoted], premises: [] }).success,
    ).toBe(true);
    expect(Claim.safeParse({ ...base, type: 'fact', sources: [], premises: [] }).success).toBe(
      false,
    );
    const unquoted = { sourceId: id(2), quote: null };
    expect(
      Claim.safeParse({ ...base, type: 'fact', sources: [unquoted], premises: [] }).success,
    ).toBe(false);
  });

  it('lets a metric cite market data without a quote', () => {
    const marketData = { sourceId: id(8), quote: null };
    expect(
      Claim.safeParse({
        ...base,
        type: 'metric',
        sources: [marketData],
        premises: [],
        figures: [{ symbol: 'NVDA', window: 'open_gap', pct: -1.07 }],
      }).success,
    ).toBe(true);
  });

  it('keeps figures to price moves of known symbols and windows, a full table at most', () => {
    const metric = (figures: unknown[]) =>
      Claim.safeParse({
        ...base,
        type: 'metric',
        sources: [{ sourceId: id(8), quote: null }],
        premises: [],
        figures,
      }).success;
    const figure = { symbol: 'NVDA', window: 'open_gap', pct: -1.07 };
    expect(metric([])).toBe(true);
    expect(metric(Array<unknown>(12).fill(figure))).toBe(true);
    expect(metric(Array<unknown>(13).fill(figure))).toBe(false);
    expect(metric([{ ...figure, symbol: 'TSLA' }])).toBe(false);
    expect(metric([{ ...figure, window: '1d' }])).toBe(false);
    // Only a metric has figures.
    expect(
      Claim.safeParse({ ...base, type: 'fact', sources: [quoted], premises: [], figures: [figure] })
        .success,
    ).toBe(false);
  });

  it('accepts only the check names defined in shared', () => {
    const checks = [{ name: 'quote_verbatim', passed: true, detail: null }];
    const fact = { ...base, type: 'fact', sources: [quoted], premises: [] };
    expect(Claim.safeParse({ ...fact, checks }).success).toBe(true);
    const advice = [{ name: 'no_advice', passed: false, detail: 'buy, sell or hold language' }];
    expect(Claim.safeParse({ ...fact, checks: advice }).success).toBe(true);
    const unknown = [{ name: 'looks_right', passed: true, detail: null }];
    expect(Claim.safeParse({ ...fact, checks: unknown }).success).toBe(false);
  });

  it('requires an inference to reference at least one premise', () => {
    expect(Claim.safeParse({ ...base, type: 'inference', sources: [], premises: [] }).success).toBe(
      false,
    );
    expect(
      Claim.safeParse({ ...base, type: 'inference', sources: [], premises: [id(9)] }).success,
    ).toBe(true);
  });
});

describe('FilingChunk', () => {
  const chunk = {
    _id: id(10),
    sourceId: id(2),
    symbol: 'NVDA',
    form: '10-K',
    section: 'Item 1A. Risk Factors',
    chunkIndex: 0,
    text: 'We utilize foundries, such as TSMC, to produce our semiconductor wafers.',
    embedding: vector(384),
    createdAt: at,
  };

  it('accepts a 384 dimension chunk', () => {
    expect(FilingChunk.safeParse(chunk).success).toBe(true);
  });

  it('rejects another dimension and an oversized text', () => {
    expect(FilingChunk.safeParse({ ...chunk, embedding: vector(768) }).success).toBe(false);
    expect(FilingChunk.safeParse({ ...chunk, text: 'x'.repeat(2001) }).success).toBe(false);
  });
});

describe('IngestCounter', () => {
  const counter = {
    _id: id(11),
    day: '2026-09-28',
    mode: 'replay',
    reason: 'duplicate',
    count: 1,
    updatedAt: at,
  };

  it('accepts a count per day, mode and reason', () => {
    expect(IngestCounter.safeParse(counter).success).toBe(true);
  });

  it('rejects a timestamp as the day, an unknown reason and a zero count', () => {
    expect(IngestCounter.safeParse({ ...counter, day: '2026-09-28T00:00:00Z' }).success).toBe(
      false,
    );
    expect(IngestCounter.safeParse({ ...counter, reason: 'spam' }).success).toBe(false);
    expect(IngestCounter.safeParse({ ...counter, count: 0 }).success).toBe(false);
  });
});

describe('ResearchBudgetDay', () => {
  const budget = { _id: id(12), day: '2026-09-29', runs: 0, updatedAt: at };

  it('accepts the runs reserved on one UTC day, from 0', () => {
    expect(ResearchBudgetDay.safeParse(budget).success).toBe(true);
    expect(ResearchBudgetDay.safeParse({ ...budget, runs: 30 }).success).toBe(true);
  });

  it('rejects a timestamp as the day and a negative or fractional count', () => {
    expect(ResearchBudgetDay.safeParse({ ...budget, day: '2026-09-29T00:00:00Z' }).success).toBe(
      false,
    );
    expect(ResearchBudgetDay.safeParse({ ...budget, runs: -1 }).success).toBe(false);
    expect(ResearchBudgetDay.safeParse({ ...budget, runs: 1.5 }).success).toBe(false);
  });
});
