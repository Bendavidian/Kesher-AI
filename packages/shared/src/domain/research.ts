import { z } from 'zod';
import { Id, LlmProvider, NonBlank } from './common';

export const TokenUsage = z.strictObject({
  input: z.int().min(0),
  output: z.int().min(0),
  total: z.int().min(0),
});
export type TokenUsage = z.infer<typeof TokenUsage>;

const stepFields = {
  // The tool, check or code step name, or what the model call was for.
  name: z.string().min(1),
  input: z.record(z.string(), z.unknown()),
  outputSummary: z.string(),
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

export const AgentRun = z.strictObject({
  _id: Id,
  userId: Id,
  eventId: Id,
  agent: z.enum(['research', 'verifier']),
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
  startedAt: z.date().nullable(),
  finishedAt: z.date().nullable(),
  createdAt: z.date(),
});
export type AgentRun = z.infer<typeof AgentRun>;

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

export const CheckResult = z.strictObject({
  name: z.string().min(1),
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
