import type {
  AgentRun,
  AgentStep,
  CheckName,
  Claim,
  FreeTierLimit,
  Report,
  RunDetail,
  RunSummary,
  ToolName,
} from '@kesher/shared';
import { VERIFIER_STEP } from '@kesher/shared';
import type { ReportSourceView } from '../view/types';
import { DEMO_EVENT, DEMO_NEWS_SOURCE, DEMO_PRICE_REACTION, NVDA_10K_SOURCE_ID } from './demoEvent';
import { PERSONAS } from './personas';

// The demo research report and its agent run (docs/design/report.dc.html and agent-run.dc.html)
// for persona A, until T08 produces real ones and T09 reads them from the api. Ids are fixed
// placeholders. Claims, quotes and price moves are the real demo values from docs/SPIKE.md.

const persona = PERSONAS.find((p) => p.key === 'A');
if (!persona) throw new Error('no persona A');

const RUN_ID = '7e1a2b3c-4d5e-4f60-8a71-b2c3d4e5f601';
const REPORT_ID = '7e1a2b3c-4d5e-4f60-8a71-b2c3d4e5f602';
const MARKET_DATA_SOURCE_ID = '9a3d6c1e-2b4f-4e5a-8c7d-0e1f2a3b4c03';

const CLAIM_ID = {
  paused: '7e1a2b3c-4d5e-4f60-8a71-b2c3d4e5f611',
  foundry: '7e1a2b3c-4d5e-4f60-8a71-b2c3d4e5f612',
  supply: '7e1a2b3c-4d5e-4f60-8a71-b2c3d4e5f613',
  openGap: '7e1a2b3c-4d5e-4f60-8a71-b2c3d4e5f614',
  removed: '7e1a2b3c-4d5e-4f60-8a71-b2c3d4e5f615',
} as const;

// Fixture data: the run start and every step timing below are sample values, not measurements.
const RUN_STARTED_AT = new Date('2026-09-28T12:00:05.000Z');
const at = (offsetMs: number) => new Date(RUN_STARTED_AT.getTime() + offsetMs);

// The run token scope, as the Run token issued step records it.
export const DEMO_TOOLS: ToolName[] = [
  'get_event',
  'get_company_relationships',
  'search_news',
  'search_filings',
  'get_price_reaction',
];

const RESEARCH_MODEL = { provider: 'google', model: 'gemini-3.5-flash-lite' } as const;
const VERIFIER_MODEL = { provider: 'groq', model: 'openai/gpt-oss-120b' } as const;

const GATE_REASON =
  'Investigate skips the relevance and importance conditions. Daily budget has room.';

const openGap = (symbol: string) =>
  DEMO_PRICE_REACTION.rows.find((row) => row.symbol === symbol)?.moves[0] ?? 0;

// A step's output as the api stores it: JSON text. An empty output stands for a step that
// returned nothing.
const json = (value: unknown) => JSON.stringify(value);

// The eleven steps from docs/design/agent-run.dc.html. latencyMs and startedAt are sample
// values; tokens are sample values too, but they add up to tokensUsed.
const STEPS: AgentStep[] = [
  {
    kind: 'code',
    name: 'Gate check',
    input: { trigger: 'investigate', eventId: DEMO_EVENT._id },
    outputSummary: GATE_REASON,
    latencyMs: 3,
    startedAt: at(0),
    output: json({ decision: 'run', reason: GATE_REASON }),
    outputTruncated: false,
  },
  {
    kind: 'code',
    name: 'Run token issued',
    input: { agent: 'research', tools: DEMO_TOOLS, ttlSeconds: 300 },
    outputSummary: 'Research agent, five read only tools, valid for 5 minutes.',
    latencyMs: 2,
    startedAt: at(5),
    output: json({ issuedAt: at(5).toISOString(), expiresAt: at(300_005).toISOString() }),
    outputTruncated: false,
  },
  {
    kind: 'tool',
    name: 'get_event',
    input: { eventId: DEMO_EVENT._id },
    outputSummary: `Loaded event ${DEMO_NEWS_SOURCE.externalId} and its extraction.`,
    latencyMs: 38,
    startedAt: at(10),
    output: json({
      eventId: DEMO_EVENT._id,
      extraction: { companies: [{ symbol: 'TSM', impact: 'negative' }], importance: 4 },
      sourceIds: DEMO_EVENT.sourceIds,
    }),
    outputTruncated: false,
  },
  {
    kind: 'tool',
    name: 'get_company_relationships',
    input: { symbol: 'TSM', types: ['supplier_of'] },
    outputSummary: 'One reviewed edge: TSM supplier_of NVDA.',
    latencyMs: 61,
    startedAt: at(50),
    output: json({
      count: 1,
      edges: [{ from: 'TSM', to: 'NVDA', type: 'supplier_of', reviewed: true }],
    }),
    outputTruncated: false,
  },
  {
    kind: 'tool',
    name: 'search_filings',
    input: { symbol: 'NVDA', query: 'foundry dependency' },
    outputSummary: 'Three passages from the NVIDIA 10-K.',
    latencyMs: 410,
    startedAt: at(115),
    output: json({
      count: 3,
      chunks: [
        { id: 'fc_nvda_10k_item1_014', section: 'Item 1. Business' },
        { id: 'fc_nvda_10k_item1a_031', section: 'Item 1A. Risk Factors' },
        { id: 'fc_nvda_10k_item1a_032', section: 'Item 1A. Risk Factors' },
      ],
    }),
    outputTruncated: false,
  },
  {
    kind: 'tool',
    name: 'search_news',
    input: { query: 'TSMC earthquake production', symbols: ['TSM', 'NVDA'], since: '2024-04-02' },
    outputSummary: 'Two related items in the recorded set.',
    latencyMs: 350,
    startedAt: at(530),
    output: '',
    outputTruncated: false,
  },
  {
    kind: 'tool',
    name: 'get_price_reaction',
    input: { symbol: 'NVDA', eventTime: DEMO_EVENT.publishedAt.toISOString() },
    outputSummary: 'Anchored to the Apr 2 close, since the headline came after hours.',
    latencyMs: 240,
    startedAt: at(885),
    output: json({
      anchor: { kind: 'previous_close', tradingDay: '2024-04-03' },
      openGap: { NVDA: openGap('NVDA'), SMH: openGap('SMH'), SPY: openGap('SPY') },
      delayed: true,
    }),
    outputTruncated: false,
  },
  {
    kind: 'model',
    name: 'Draft claims',
    input: { mode: 'deep', toolResults: 5 },
    outputSummary: 'Five claims, all valid against the schema.',
    latencyMs: 3_900,
    startedAt: at(1_130),
    output: '',
    outputTruncated: false,
    ...RESEARCH_MODEL,
    tokens: { input: 2_610, output: 870, total: 3_480 },
  },
  {
    kind: 'check',
    name: 'Deterministic checks',
    input: { claims: 5 },
    outputSummary: "Four passed. One quote wasn't found in its source, so that claim was removed.",
    latencyMs: 11,
    startedAt: at(5_040),
    output: json({
      removedClaimIds: [CLAIM_ID.removed],
      failures: [{ claimId: CLAIM_ID.removed, check: 'quote_verbatim' }],
    }),
    outputTruncated: false,
  },
  {
    kind: 'model',
    name: VERIFIER_STEP,
    input: { claims: 4 },
    outputSummary: 'Separate context, read only. Four claims supported.',
    latencyMs: 2_700,
    startedAt: at(5_060),
    output: json({ supported: 4, unsupported: 0 }),
    outputTruncated: false,
    ...VERIFIER_MODEL,
    tokens: { input: 1_450, output: 470, total: 1_920 },
  },
  {
    kind: 'code',
    name: 'Report attached',
    input: { reportId: REPORT_ID },
    outputSummary: 'Sent to your card in the feed.',
    latencyMs: 6,
    startedAt: at(7_770),
    output: '',
    outputTruncated: false,
  },
];

export const DEMO_RUN: AgentRun = {
  _id: RUN_ID,
  userId: persona._id,
  eventId: DEMO_EVENT._id,
  agent: 'research',
  mode: 'deep',
  trigger: 'investigate',
  gate: { decision: 'run', reason: GATE_REASON },
  stepBudget: 15,
  tokenBudget: 20_000,
  steps: STEPS,
  // The research agent's model steps; the verifier counts against its own cap.
  tokensUsed: STEPS.reduce(
    (sum, step) =>
      sum + (step.kind === 'model' && step.name !== VERIFIER_STEP ? step.tokens.total : 0),
    0,
  ),
  verification: { tokenCap: 6_000, tokensUsed: 1_920 },
  costUsd: 0,
  status: 'succeeded',
  failureReason: null,
  startedAt: RUN_STARTED_AT,
  finishedAt: at(7_776),
  createdAt: RUN_STARTED_AT,
};

const REPORT_AT = at(7_770);

// Claim 2 quotes the NVIDIA 10-K verbatim (docs/SPIKE.md check 1).
const NVDA_FOUNDRY_QUOTE =
  'We utilize foundries, such as Taiwan Semiconductor Manufacturing Company Limited, or TSMC, and Samsung Electronics Co., Ltd., or Samsung, to produce our semiconductor wafers.';

const claimBase = { reportId: REPORT_ID, createdAt: REPORT_AT } as const;
const passed = (name: CheckName) => ({ name, passed: true, detail: null });

export const DEMO_CLAIMS: Claim[] = [
  {
    ...claimBase,
    _id: CLAIM_ID.paused,
    type: 'fact',
    text: 'TSMC suspended some chip production after a strong earthquake in Taiwan.',
    status: 'supported',
    sources: [{ sourceId: DEMO_NEWS_SOURCE._id, quote: DEMO_EVENT.headline }],
    premises: [],
    checks: [passed('quote_verbatim'), passed('verifier')],
  },
  {
    ...claimBase,
    _id: CLAIM_ID.foundry,
    type: 'fact',
    text: 'NVIDIA relies on TSMC to produce its semiconductor wafers.',
    status: 'supported',
    sources: [{ sourceId: NVDA_10K_SOURCE_ID, quote: NVDA_FOUNDRY_QUOTE }],
    premises: [],
    checks: [passed('quote_verbatim'), passed('verifier')],
  },
  {
    ...claimBase,
    _id: CLAIM_ID.supply,
    type: 'inference',
    text: "A longer disruption at TSMC could affect NVIDIA's supply.",
    status: 'supported',
    sources: [],
    premises: [CLAIM_ID.paused, CLAIM_ID.foundry],
    checks: [passed('premises_supported'), passed('verifier')],
  },
  {
    ...claimBase,
    _id: CLAIM_ID.openGap,
    type: 'metric',
    text: 'NVDA opened −1.07% below the previous close, close to SMH at −1.00%. SPY opened −0.22%.',
    status: 'supported',
    sources: [{ sourceId: MARKET_DATA_SOURCE_ID, quote: null }],
    premises: [],
    figures: [
      { symbol: 'NVDA', window: 'open_gap', pct: -1.07 },
      { symbol: 'SMH', window: 'open_gap', pct: -1 },
      { symbol: 'SPY', window: 'open_gap', pct: -0.22 },
    ],
    checks: [passed('numbers_match'), passed('verifier')],
  },
  // Removed by the deterministic checks: its quote is not in the cited source. The screens
  // never show its text.
  {
    ...claimBase,
    _id: CLAIM_ID.removed,
    type: 'fact',
    text: 'TSMC expects every affected fab to be back at full output within two days.',
    status: 'removed',
    sources: [
      {
        sourceId: DEMO_NEWS_SOURCE._id,
        quote: 'All affected fabs will be back at full output within two days.',
      },
    ],
    premises: [],
    checks: [
      {
        name: 'quote_verbatim',
        passed: false,
        detail: `Quote not found in source ${DEMO_NEWS_SOURCE.externalId}.`,
      },
    ],
  },
];

export const DEMO_REPORT: Report = {
  _id: REPORT_ID,
  runId: RUN_ID,
  sections: [
    {
      title: 'What happened and how it reaches you',
      claimIds: DEMO_CLAIMS.map((claim) => claim._id),
    },
  ],
  openQuestions: [
    'How long could output at the affected fabs stay reduced?',
    'Has NVIDIA said anything about supply since the event?',
  ],
  createdAt: REPORT_AT,
};

export const DEMO_REPORT_SOURCES: ReportSourceView[] = [
  {
    _id: DEMO_NEWS_SOURCE._id,
    kind: 'news',
    tier: DEMO_NEWS_SOURCE.tier,
    title: `${DEMO_NEWS_SOURCE.wire} via Alpaca`,
    citeLabel: `${DEMO_NEWS_SOURCE.wire} headline`,
    ref: `id ${DEMO_NEWS_SOURCE.externalId}`,
  },
  {
    _id: NVDA_10K_SOURCE_ID,
    kind: 'filing',
    tier: 1,
    title: 'NVIDIA 10-K, filed Feb 25, 2026',
    citeLabel: 'NVIDIA 10-K, filed Feb 25, 2026',
    ref: '0001045810-26-000021',
  },
  {
    _id: MARKET_DATA_SOURCE_ID,
    kind: 'market_data',
    tier: 1,
    title: 'SIP bars for TSM, NVDA, SMH and SPY',
    // As the api names it; the report screen adds the anchor from the card's price reaction.
    citeLabel: 'SIP bars',
    ref: 'Delayed 15 minutes',
  },
];

// The free tier limits the api serves for the two models of the demo run (docs/SPIKE.md).
export const DEMO_LIMITS: FreeTierLimit[] = [
  {
    provider: 'google',
    model: 'gemini-3.5-flash-lite',
    tokensPerMinute: 250_000,
    requestsPerDay: 500,
  },
  { provider: 'groq', model: 'openai/gpt-oss-120b', tokensPerMinute: 8_000, requestsPerDay: 1_000 },
];

// The demo run as GET /runs/:runId answers it for persona A.
export const DEMO_RUN_DETAIL: RunDetail = {
  run: DEMO_RUN,
  reportId: REPORT_ID,
  claims: DEMO_CLAIMS,
  eventSymbol: 'TSM',
  limits: DEMO_LIMITS,
};

// A second run on the same event that a 429 ended, for the Recent runs selector. Sample values.
const FAILED_STARTED_AT = new Date('2026-09-28T12:20:00.000Z');
export const DEMO_FAILED_RUN: AgentRun = {
  ...DEMO_RUN,
  _id: '7e1a2b3c-4d5e-4f60-8a71-b2c3d4e5f603',
  steps: [
    ...STEPS.slice(0, 3),
    {
      kind: 'code',
      name: 'Rate limit wait',
      input: { provider: 'google', model: 'gemini-3.5-flash-lite', attempt: 4 },
      outputSummary: '429 from google asked for a wait over 30 seconds; the run stops.',
      output: json({ waitMs: 45_000 }),
      outputTruncated: false,
      latencyMs: 0,
      startedAt: FAILED_STARTED_AT,
    },
  ],
  tokensUsed: 0,
  status: 'failed',
  failureReason: 'rate_limited',
  startedAt: FAILED_STARTED_AT,
  finishedAt: FAILED_STARTED_AT,
  createdAt: FAILED_STARTED_AT,
};

export const DEMO_FAILED_RUN_DETAIL: RunDetail = {
  run: DEMO_FAILED_RUN,
  reportId: null,
  claims: [],
  eventSymbol: 'TSM',
  limits: [],
};

const summaryOf = (run: AgentRun): RunSummary => ({
  _id: run._id,
  eventId: run.eventId,
  eventSymbol: 'TSM',
  agent: run.agent,
  mode: run.mode,
  trigger: run.trigger,
  status: run.status,
  tokensUsed: run.tokensUsed,
  createdAt: run.createdAt,
});

// GET /runs for persona A, newest first.
export const DEMO_RUN_SUMMARIES: RunSummary[] = [summaryOf(DEMO_FAILED_RUN), summaryOf(DEMO_RUN)];
