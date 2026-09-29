import type { AgentRun, AgentStep, CheckName, Claim, Report } from '@kesher/shared';
import { formatDay } from '../view/format';
import type { ReportSourceView, RunTokenScope, StepOutput } from '../view/types';
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

const TOOLS = [
  'get_event',
  'get_company_relationships',
  'search_news',
  'search_filings',
  'get_price_reaction',
];

export const DEMO_TOKEN_SCOPE: RunTokenScope = {
  agent: 'research',
  tools: TOOLS,
  writes: [],
  ttlMinutes: 5,
};

const RESEARCH_MODEL = { provider: 'google', model: 'gemini-3.5-flash-lite' } as const;
const VERIFIER_MODEL = { provider: 'groq', model: 'openai/gpt-oss-120b' } as const;

const GATE_REASON =
  'Investigate skips the relevance and importance conditions. Daily budget has room.';

const openGap = (symbol: string) =>
  DEMO_PRICE_REACTION.rows.find((row) => row.symbol === symbol)?.moves[0] ?? 0;

// The eleven steps from docs/design/agent-run.dc.html. latencyMs and startedAt are sample
// values; tokens are sample values too, but they add up to tokensUsed. output stays empty here;
// the detail panel reads DEMO_STEP_OUTPUTS until T09 shows the stored output.
const STEPS: AgentStep[] = [
  {
    kind: 'code',
    name: 'Gate check',
    input: { trigger: 'investigate', eventId: DEMO_EVENT._id },
    outputSummary: GATE_REASON,
    latencyMs: 3,
    startedAt: at(0),
    output: '',
    outputTruncated: false,
  },
  {
    kind: 'code',
    name: 'Run token issued',
    input: { agent: DEMO_TOKEN_SCOPE.agent, tools: TOOLS, ttlMinutes: DEMO_TOKEN_SCOPE.ttlMinutes },
    outputSummary: 'Research agent, five read only tools, valid for 5 minutes.',
    latencyMs: 2,
    startedAt: at(5),
    output: '',
    outputTruncated: false,
  },
  {
    kind: 'tool',
    name: 'get_event',
    input: { eventId: DEMO_EVENT._id },
    outputSummary: `Loaded event ${DEMO_NEWS_SOURCE.externalId} and its extraction.`,
    latencyMs: 38,
    startedAt: at(10),
    output: '',
    outputTruncated: false,
  },
  {
    kind: 'tool',
    name: 'get_company_relationships',
    input: { symbol: 'TSM', types: ['supplier_of'] },
    outputSummary: 'One reviewed edge: TSM supplier_of NVDA.',
    latencyMs: 61,
    startedAt: at(50),
    output: '',
    outputTruncated: false,
  },
  {
    kind: 'tool',
    name: 'search_filings',
    input: { symbol: 'NVDA', query: 'foundry dependency' },
    outputSummary: 'Three passages from the NVIDIA 10-K.',
    latencyMs: 410,
    startedAt: at(115),
    output: '',
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
    output: '',
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
    output: '',
    outputTruncated: false,
  },
  {
    kind: 'model',
    name: 'Verifier agent',
    input: { claims: 4 },
    outputSummary: 'Separate context, read only. Four claims supported.',
    latencyMs: 2_700,
    startedAt: at(5_060),
    output: '',
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
  agent: DEMO_TOKEN_SCOPE.agent,
  mode: 'deep',
  trigger: 'investigate',
  gate: { decision: 'run', reason: GATE_REASON },
  stepBudget: 15,
  tokenBudget: 6_000,
  steps: STEPS,
  tokensUsed: STEPS.reduce((sum, step) => sum + (step.kind === 'model' ? step.tokens.total : 0), 0),
  costUsd: 0,
  status: 'succeeded',
  failureReason: null,
  startedAt: RUN_STARTED_AT,
  finishedAt: at(7_776),
  createdAt: RUN_STARTED_AT,
};

// Full outputs by step index, for the detail panel. Steps without one show their summary.
export const DEMO_STEP_OUTPUTS: Partial<Record<number, StepOutput>> = {
  0: { value: { decision: 'run', reason: GATE_REASON }, note: null },
  2: {
    value: {
      eventId: DEMO_EVENT._id,
      extraction: { companies: [{ symbol: 'TSM', impact: 'negative' }], importance: 4 },
      sourceIds: DEMO_EVENT.sourceIds,
    },
    note: null,
  },
  3: {
    value: { count: 1, edges: [{ from: 'TSM', to: 'NVDA', type: 'supplier_of', reviewed: true }] },
    note: 'reviewed edges only',
  },
  4: {
    value: {
      count: 3,
      chunks: [
        { id: 'fc_nvda_10k_item1_014', section: 'Item 1. Business' },
        { id: 'fc_nvda_10k_item1a_031', section: 'Item 1A. Risk Factors' },
        { id: 'fc_nvda_10k_item1a_032', section: 'Item 1A. Risk Factors' },
      ],
    },
    note: 'capped at 3 chunks',
  },
  6: {
    value: {
      anchor: { kind: 'previous_close', tradingDay: '2024-04-03' },
      openGap: { NVDA: openGap('NVDA'), SMH: openGap('SMH'), SPY: openGap('SPY') },
      delayed: true,
    },
    note: null,
  },
  8: { value: { passed: 4, removed: 1, failedCheck: 'quote_verbatim' }, note: null },
  9: { value: { supported: 4, unsupported: 0 }, note: null },
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

const { anchor } = DEMO_PRICE_REACTION;
const anchorDay = formatDay(anchor.baseAt, 'America/New_York', false);
const anchorNote =
  anchor.kind === 'previous_close'
    ? `anchored to the regular close on ${anchorDay} because the headline came after hours`
    : `anchored to the price at the headline on ${anchorDay}`;

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
    citeLabel: `SIP bars, ${anchorNote}`,
    ref: 'Delayed 15 minutes',
  },
];
