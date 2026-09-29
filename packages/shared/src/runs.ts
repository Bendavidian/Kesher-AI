import { z } from 'zod';
import { Id, LlmProvider, Ticker } from './domain/common';
import { AgentRun, Claim } from './domain/research';

// A model's free tier limits as the run screen footer shows them (docs/SPIKE.md, Console
// numbers), served by the api from its own limiter table.
export const FreeTierLimit = z.strictObject({
  provider: LlmProvider,
  model: z.string().min(1),
  tokensPerMinute: z.int().positive(),
  requestsPerDay: z.int().positive(),
});
export type FreeTierLimit = z.infer<typeof FreeTierLimit>;

// GET /runs/:runId: one run of the signed in user with its steps, the claims of its report
// (removed ones included), the report id once there is one, the event's first extracted symbol
// for the summary line, and the free tier limits of the models its steps used. Step output is
// redacted, capped at 8 KB and may quote untrusted excerpts, which the web renders as text only.
export const RunDetail = z.strictObject({
  run: AgentRun,
  reportId: Id.nullable(),
  claims: z.array(Claim),
  eventSymbol: Ticker.nullable(),
  limits: z.array(FreeTierLimit),
});
export type RunDetail = z.infer<typeof RunDetail>;

// One row of GET /runs, the signed in user's runs, newest first.
export const RunSummary = z.strictObject({
  _id: Id,
  eventId: Id,
  eventSymbol: Ticker.nullable(),
  agent: AgentRun.shape.agent,
  mode: AgentRun.shape.mode,
  trigger: AgentRun.shape.trigger,
  status: AgentRun.shape.status,
  tokensUsed: AgentRun.shape.tokensUsed,
  createdAt: z.date(),
});
export type RunSummary = z.infer<typeof RunSummary>;
