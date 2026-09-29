import { z } from 'zod';
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
    tokenBudget: z.int().positive(),
    steps: z.array(AgentStep),
    tokensUsed: z.int().min(0),
    // Computed by code; 0 on the free tiers, where any paid call is a bug.
    costUsd: z.number().min(0),
    status: z.enum(['queued', 'running', 'succeeded', 'failed', 'budget_exhausted', 'skipped']),
    failureReason: RunFailureReason.nullable(),
    startedAt: z.date().nullable(),
    finishedAt: z.date().nullable(),
    createdAt: z.date(),
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
  updatedAt: z.date(),
});
export type ResearchBudgetDay = z.infer<typeof ResearchBudgetDay>;

export const Report = z.strictObject({
  _id: Id,
  runId: Id,
  sections: z.array(z.strictObject({ title: NonBlank, claimIds: z.array(Id) })),
  openQuestions: z.array(NonBlank),
  createdAt: z.date(),
});
export type Report = z.infer<typeof Report>;

export const ClaimStatus = z.enum(['unverified', 'supported', 'removed']);
export type ClaimStatus = z.infer<typeof ClaimStatus>;

// Every check has one name, used by the api, the run steps and the web (T14 adds the rest).
export const CheckName = z.enum([
  'quote_verbatim',
  'numbers_match',
  'sources_exist',
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

// A fact always cites a verbatim quote. A metric may cite market data, which has no quote.
const QuotedSource = z.strictObject({ sourceId: Id, quote: NonBlank });
const CitedSource = z.strictObject({ sourceId: Id, quote: NonBlank.nullable() });

const claimFields = {
  _id: Id,
  reportId: Id,
  text: NonBlank,
  status: ClaimStatus,
  checks: z.array(CheckResult),
  createdAt: z.date(),
};

// Typed claims, SPEC.md Claims and verification. Whether premises are supported is checked
// in T14, not here.
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
  }),
  z.strictObject({
    type: z.literal('inference'),
    ...claimFields,
    sources: z.array(CitedSource),
    premises: z.array(Id).min(1),
  }),
]);
export type Claim = z.infer<typeof Claim>;
