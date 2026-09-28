import type { AgentRun, AgentStep, Claim, LlmProvider } from '@kesher/shared';

// The Agent runs screen (docs/UI.md, Agent run screen). Every label here is a template over
// the stored run; nothing is written by a model.

// The timeline color of a step: code teal, tool blue, model amber, and red for a check that
// removed a claim.
export type StepTone = 'code' | 'tool' | 'model' | 'removed';

// AgentStep does not say which claims a check removed, so any check step in a run whose report
// lost a claim is red. T14 can link checks to claims once there is more than one check step.
export function stepTone(step: AgentStep, removedClaims: number): StepTone {
  if (step.kind === 'check') return removedClaims > 0 ? 'removed' : 'code';
  return step.kind;
}

export const TONE_LABEL: Record<StepTone, string> = {
  code: 'Code',
  tool: 'Tool call',
  model: 'Model',
  removed: 'Check that removed a claim',
};

// 410 ms, 3.9 s
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

// 846, 3.5k, 6k
export function formatTokens(tokens: number): string {
  if (tokens < 1000) return String(tokens);
  return `${(tokens / 1000).toFixed(1).replace(/\.0$/, '')}k`;
}

export const PROVIDER_LABEL: Record<LlmProvider, string> = {
  google: 'Gemini',
  groq: 'Groq',
};

// The free tier limits from docs/SPIKE.md, Console numbers, for the models a run can use.
// apps/api/src/llm/limits.ts holds the same numbers; T09 can serve them from the api.
const FREE_TIER: Record<string, { tpm: number; rpd: number }> = {
  'google:gemini-3.5-flash-lite': { tpm: 250_000, rpd: 500 },
  'groq:openai/gpt-oss-120b': { tpm: 8_000, rpd: 1_000 },
};

const STATUS: Record<AgentRun['status'], { label: string; tone: 'up' | 'down' | 'neutral' }> = {
  queued: { label: 'Queued', tone: 'neutral' },
  running: { label: 'Running', tone: 'neutral' },
  succeeded: { label: 'Completed', tone: 'up' },
  failed: { label: 'Failed', tone: 'down' },
  budget_exhausted: { label: 'Budget spent', tone: 'neutral' },
  skipped: { label: 'Skipped', tone: 'neutral' },
};

export const MODE_LABEL: Record<AgentRun['mode'], string> = {
  auto: 'Auto mode',
  deep: 'Deep mode',
};

export interface StepView {
  step: AgentStep;
  number: number;
  tone: StepTone;
  duration: string;
  tokens: string | null;
}

export interface RunView {
  mode: string;
  status: (typeof STATUS)[AgentRun['status']];
  summary: string;
  toolCalls: string;
  tokens: string;
  model: string | null;
  cost: string;
  steps: StepView[];
  limits: string[];
  budget: string;
}

const toolCallCount = (run: AgentRun) => run.steps.filter((step) => step.kind === 'tool').length;

// 5 of 15
export function toolCallsLabel(run: AgentRun): string {
  return `${toolCallCount(run)} of ${run.stepBudget}`;
}

function summary(run: AgentRun, eventName: string): string {
  const started =
    run.trigger === 'investigate'
      ? `Started when you chose Investigate on the ${eventName} event.`
      : `Started by the research gate on the ${eventName} event.`;
  if (!run.startedAt || !run.finishedAt) return started;
  const took = formatDuration(run.finishedAt.getTime() - run.startedAt.getTime());
  return `${started} Finished in ${took}.`;
}

export function buildRunView(run: AgentRun, claims: Claim[], eventName: string): RunView {
  const removed = claims.filter((claim) => claim.status === 'removed').length;
  const modelSteps = run.steps.flatMap((step) => (step.kind === 'model' ? [step] : []));
  const models = new Map(modelSteps.map((step) => [`${step.provider}:${step.model}`, step]));

  return {
    mode: MODE_LABEL[run.mode],
    status: STATUS[run.status],
    summary: summary(run, eventName),
    toolCalls: toolCallsLabel(run),
    tokens: `${formatTokens(run.tokensUsed)} of ${formatTokens(run.tokenBudget)}`,
    // The research agent picks its model once per run, so the first model step names it.
    model: modelSteps[0]?.model ?? null,
    cost: `$${run.costUsd.toFixed(2)}`,
    steps: run.steps.map((step, index) => ({
      step,
      number: index + 1,
      tone: stepTone(step, removed),
      duration: formatDuration(step.latencyMs),
      tokens: step.kind === 'model' ? `${formatTokens(step.tokens.total)} tok` : null,
    })),
    limits: [...models].flatMap(([key, { provider }]) => {
      const limit = FREE_TIER[key];
      if (!limit) return [];
      const tpm = limit.tpm.toLocaleString('en-US');
      const rpd = limit.rpd.toLocaleString('en-US');
      return [
        `${PROVIDER_LABEL[provider]} free tier: ${tpm} tokens per minute, ${rpd} requests per day`,
      ];
    }),
    budget: `Token budget per run: ${run.tokenBudget.toLocaleString('en-US')}`,
  };
}

// The 1-based step the removed claim link opens: the first check that removed a claim.
export function removingCheckStep(run: AgentRun, claims: Claim[]): number | null {
  const removed = claims.filter((claim) => claim.status === 'removed').length;
  const index = run.steps.findIndex((step) => stepTone(step, removed) === 'removed');
  return index === -1 ? null : index + 1;
}
