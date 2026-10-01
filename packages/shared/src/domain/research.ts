import { z } from 'zod';
import { PRICE_WINDOWS, PriceSymbol, PriceWindowName } from '../price';
import { Id, LlmProvider, NonBlank } from './common';

export const TokenUsage = z.strictObject({
  input: z.int().min(0),
  output: z.int().min(0),
  total: z.int().min(0),
});
export type TokenUsage = z.infer<typeof TokenUsage>;

// A step keeps at most 8 KB of its output, measured in UTF-8 bytes.
export const MAX_STEP_OUTPUT_BYTES = 8_192;

// UTF-8 bytes without TextEncoder, which this package's libs do not declare. A lone surrogate
// counts 3, as the U+FFFD it is encoded as.
export function utf8Length(text: string): number {
  let bytes = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
}

const stepFields = {
  // The tool, check or code step name, or what the model call was for.
  name: z.string().min(1),
  input: z.record(z.string(), z.unknown()),
  outputSummary: z.string(),
  // The step's output as JSON text, redacted before it was capped. outputTruncated says whether
  // the cap cut it, so the text may not parse as JSON.
  output: z.string().refine((text) => utf8Length(text) <= MAX_STEP_OUTPUT_BYTES, {
    error: `step output is capped at ${MAX_STEP_OUTPUT_BYTES} bytes`,
  }),
  outputTruncated: z.boolean(),
  latencyMs: z.number().min(0),
  startedAt: z.date(),
};

// Step kinds follow the Agent Runs timeline in docs/UI.md. Model steps record the provider,
// model and tokens they used.
export const AgentStep = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('model'),
    ...stepFields,
    provider: LlmProvider,
    model: z.string().min(1),
    tokens: TokenUsage,
  }),
  z.strictObject({ kind: z.literal('tool'), ...stepFields }),
  z.strictObject({ kind: z.literal('code'), ...stepFields }),
  z.strictObject({ kind: z.literal('check'), ...stepFields }),
]);
export type AgentStep = z.infer<typeof AgentStep>;

// The name of a verifier call's model step. Its tokens count against the run's verification cap,
// not the research budget.
export const VERIFIER_STEP = 'Verifier';

// The name of the code step that lists the claims code writes before the model's turns
// (SPEC.md decision log, T20).
export const CODE_CLAIMS_STEP = 'Code claims';

// The agents that run with a run token (docs/INTERFACES.md).
export const AgentName = z.enum(['research', 'verifier']);
export type AgentName = z.infer<typeof AgentName>;

// The MVP tools in docs/INTERFACES.md, as a run token names them. A token may list a tool before
// the server implements it.
export const TOOL_NAMES = [
  'get_my_portfolio',
  'get_event',
  'get_company_relationships',
  'search_news',
  'search_filings',
  'get_price_reaction',
  'get_financial_facts',
] as const;
export const ToolName = z.enum(TOOL_NAMES);
export type ToolName = z.infer<typeof ToolName>;

// The tool set of each agent (SPEC.md decision log, T13). A run token lists only tools from its
// agent's set. The verifier has no tools by design: it judges the claims and the sources it is
// given, and never searches for new ones.
export const AGENT_TOOLS: Readonly<Record<AgentName, readonly ToolName[]>> = {
  research: [
    'get_my_portfolio',
    'get_event',
    'search_news',
    'search_filings',
    'get_company_relationships',
    'get_price_reaction',
    'get_financial_facts',
  ],
  verifier: [],
};

export function toolsAllowed(agent: AgentName, tools: readonly ToolName[]): boolean {
  return tools.every((tool) => AGENT_TOOLS[agent].includes(tool));
}

// Why a run ended as failed. rate_limited: a provider asked for a wait over 30 seconds or kept
// answering 429 after 3 retries. invalid_report: the report never passed its schema.
export const RunFailureReason = z.enum(['rate_limited', 'invalid_report', 'error']);
export type RunFailureReason = z.infer<typeof RunFailureReason>;

export const AgentRun = z
  .strictObject({
    _id: Id,
    userId: Id,
    eventId: Id,
    agent: AgentName,
    mode: z.enum(['auto', 'deep']),
    trigger: z.enum(['gate', 'investigate']),
    // Decided by code policy, with the reason shown in Agent Runs.
    gate: z.strictObject({ decision: z.enum(['run', 'skip']), reason: NonBlank }),
    stepBudget: z.int().positive(),
    // The research agent's tokens. tokensUsed counts its model steps only.
    tokenBudget: z.int().positive(),
    steps: z.array(AgentStep),
    tokensUsed: z.int().min(0),
    // The verifier's own token cap and use, apart from the research budget so verification never
    // starves research (SPEC.md decision log, T14). null for a run that never verifies, such as a
    // skipped one, and for runs stored before T14.
    verification: z
      .strictObject({ tokenCap: z.int().positive(), tokensUsed: z.int().min(0) })
      .nullable(),
    // Computed by code; 0 on the free tiers, where any paid call is a bug.
    costUsd: z.number().min(0),
    status: z.enum(['queued', 'running', 'succeeded', 'failed', 'budget_exhausted', 'skipped']),
    failureReason: RunFailureReason.nullable(),
    startedAt: z.date().nullable(),
    finishedAt: z.date().nullable(),
    createdAt: z.date(),
    // A guest's runs expire with the guest (SPEC.md decision log, T24).
    expiresAt: z.date().optional(),
  })
  .refine((run) => (run.failureReason === null) === (run.status !== 'failed'), {
    error: 'a run names a failure reason exactly when it failed',
    path: ['failureReason'],
  });
export type AgentRun = z.infer<typeof AgentRun>;

// Research runs reserved per UTC day, automatic and Investigate together (the daily budget of
// the research gate, SPEC.md decision log T12). A skipped run reserves nothing.
export const ResearchBudgetDay = z.strictObject({
  _id: Id,
  day: z.iso.date(),
  runs: z.int().min(0),
  // Of those, the runs guests reserved (T24); missing on days stored before it.
  guestRuns: z.int().min(0).optional(),
  updatedAt: z.date(),
});
export type ResearchBudgetDay = z.infer<typeof ResearchBudgetDay>;

// A claim code would have written and left out, with the reason (SPEC.md decision log, T20).
// path_fact: a hop whose reviewed evidence or filing could not be read (no_evidence).
// price_metric: a move it needs is not ready yet (not_ready), or the market data could not be
// read (unavailable). The report screen shows one neutral line for each.
export const CodeClaimOmission = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('path_fact'), reason: z.literal('no_evidence') }),
  z.strictObject({
    kind: z.literal('price_metric'),
    reason: z.enum(['not_ready', 'unavailable']),
  }),
]);
export type CodeClaimOmission = z.infer<typeof CodeClaimOmission>;

export const Report = z.strictObject({
  _id: Id,
  runId: Id,
  sections: z.array(z.strictObject({ title: NonBlank, claimIds: z.array(Id) })),
  openQuestions: z.array(NonBlank),
  // At most one per hop and one price metric.
  omitted: z.array(CodeClaimOmission).max(3),
  createdAt: z.date(),
  // A guest's reports expire with the guest (T24).
  expiresAt: z.date().optional(),
});
export type Report = z.infer<typeof Report>;

export const ClaimStatus = z.enum(['unverified', 'supported', 'removed']);
export type ClaimStatus = z.infer<typeof ClaimStatus>;

// Every check has one name, used by the api, the run steps and the web.
export const CheckName = z.enum([
  'quote_verbatim',
  'numbers_match',
  'sources_exist',
  'no_advice',
  'premises_supported',
  'verifier',
]);
export type CheckName = z.infer<typeof CheckName>;

export const CheckResult = z.strictObject({
  name: CheckName,
  passed: z.boolean(),
  detail: z.string().nullable(),
});
export type CheckResult = z.infer<typeof CheckResult>;

// One number of a metric claim: a move from the price reaction, as the model read it. code checks
// it against the reaction it computes itself (numbers_match); the number never drives logic.
export const MetricFigure = z.strictObject({
  symbol: PriceSymbol,
  window: PriceWindowName,
  pct: z.number(),
});
export type MetricFigure = z.infer<typeof MetricFigure>;

// A full table: a stock, SMH and SPY in every window.
export const MAX_METRIC_FIGURES = 3 * PRICE_WINDOWS.length;

// A fact always cites a verbatim quote. A metric may cite market data, which has no quote.
const QuotedSource = z.strictObject({ sourceId: Id, quote: NonBlank });
const CitedSource = z.strictObject({ sourceId: Id, quote: NonBlank.nullable() });

// Who wrote the claim: code from the path's evidence and the price reaction, or the research
// model. Both go through the same checks and the verifier; the evals can report them apart.
export const ClaimOrigin = z.enum(['code', 'model']);
export type ClaimOrigin = z.infer<typeof ClaimOrigin>;

const claimFields = {
  _id: Id,
  reportId: Id,
  origin: ClaimOrigin,
  text: NonBlank,
  status: ClaimStatus,
  checks: z.array(CheckResult),
  createdAt: z.date(),
  // A guest's claims expire with the guest (T24).
  expiresAt: z.date().optional(),
};

// Typed claims, SPEC.md Claims and verification. Code sets the status: removed when a check
// fails, supported once the verifier supports it, unverified otherwise.
export const Claim = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('fact'),
    ...claimFields,
    sources: z.array(QuotedSource).min(1),
    premises: z.array(Id).max(0),
  }),
  z.strictObject({
    type: z.literal('metric'),
    ...claimFields,
    sources: z.array(CitedSource).min(1),
    premises: z.array(Id).max(0),
    // Price moves only. Empty for any other number, such as a financial fact, which stays
    // unverified until XBRL arrives (T13 part 2).
    figures: z.array(MetricFigure).max(MAX_METRIC_FIGURES),
  }),
  z.strictObject({
    type: z.literal('inference'),
    ...claimFields,
    sources: z.array(CitedSource),
    premises: z.array(Id).min(1),
  }),
]);
export type Claim = z.infer<typeof Claim>;
