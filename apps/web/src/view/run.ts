import {
  AgentName,
  ToolName,
  type AgentRun,
  type AgentStep,
  type FreeTierLimit,
  type LlmProvider,
  type RunFailureReason,
  type RunStepPushed,
  type RunSummary,
  VERIFIER_STEP,
} from '@kesher/shared';
import { formatEtShort } from './format';
import type { RunTokenScope } from './types';

// The Agent runs screen (docs/UI.md, Agent run screen). Every label here is a template over
// the stored run; nothing is written by a model.

// The timeline color of a step: code teal, tool blue, model amber, and red for a check that
// removed a claim.
export type StepTone = 'code' | 'tool' | 'model' | 'removed';

// A step's output as JSON, or undefined when it is empty, cut by the 8 KB cap or not JSON.
function parsedOutput(step: AgentStep): unknown {
  if (step.output === '' || step.outputTruncated) return undefined;
  try {
    return JSON.parse(step.output) as unknown;
  } catch {
    return undefined;
  }
}

// The claims a check step removed, from its stored output (docs/INTERFACES.md, Agent runs).
export function removedClaimIds(step: AgentStep): string[] {
  if (step.kind !== 'check') return [];
  const output = parsedOutput(step);
  const ids =
    output !== null && typeof output === 'object' && 'removedClaimIds' in output
      ? output.removedClaimIds
      : undefined;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [];
}

// A check is red when it removed a claim; otherwise it is code.
export function stepTone(step: AgentStep): StepTone {
  if (step.kind === 'check') return removedClaimIds(step).length > 0 ? 'removed' : 'code';
  return step.kind;
}

// How the detail panel shows a step's output. Output is untrusted text that may quote a news
// excerpt: it is only ever rendered as text, never as markup.
export type OutputView =
  | { format: 'json'; value: unknown; note: string | null }
  | { format: 'text'; text: string; note: string | null }
  | { format: 'none' };

export function outputView(step: AgentStep): OutputView {
  if (step.output === '') return { format: 'none' };
  const note = step.outputTruncated ? 'capped at 8 KB' : null;
  const value = parsedOutput(step);
  return value === undefined
    ? { format: 'text', text: step.output, note }
    : { format: 'json', value, note };
}

// The run token scope, read from the run's own Run token issued step: what was really minted.
export function tokenScope(run: AgentRun): RunTokenScope | null {
  const step = run.steps.find((s) => s.kind === 'code' && s.name === 'Run token issued');
  if (!step) return null;
  const { agent, tools, ttlSeconds } = step.input;
  const parsedAgent = AgentName.safeParse(agent);
  const parsedTools = Array.isArray(tools) ? tools.map((tool) => ToolName.safeParse(tool)) : [];
  if (
    !parsedAgent.success ||
    parsedTools.length === 0 ||
    !parsedTools.every((tool) => tool.success) ||
    typeof ttlSeconds !== 'number' ||
    ttlSeconds <= 0
  ) {
    return null;
  }
  return {
    agent: parsedAgent.data,
    tools: parsedTools.flatMap((tool) => (tool.success ? [tool.data] : [])),
    ttlMinutes: ttlSeconds / 60,
  };
}

// Adds a pushed step to the run it belongs to. A step already held is ignored; a step past the
// next one means a push was missed, and the caller reads the run again.
export function withPushedStep(run: AgentRun, pushed: RunStepPushed): AgentRun | 'gap' {
  if (pushed.index < run.steps.length) return run;
  if (pushed.index > run.steps.length) return 'gap';
  const { step } = pushed;
  const tokens = step.kind === 'model' ? step.tokens.total : 0;
  // A verifier call counts against the verification cap, never the research budget.
  if (step.kind === 'model' && step.name === VERIFIER_STEP && run.verification) {
    return {
      ...run,
      steps: [...run.steps, step],
      verification: { ...run.verification, tokensUsed: run.verification.tokensUsed + tokens },
    };
  }
  return { ...run, steps: [...run.steps, step], tokensUsed: run.tokensUsed + tokens };
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

export const RUN_STATUS: Record<
  AgentRun['status'],
  { label: string; tone: 'up' | 'down' | 'neutral' }
> = {
  queued: { label: 'Queued', tone: 'neutral' },
  running: { label: 'Running', tone: 'neutral' },
  succeeded: { label: 'Completed', tone: 'up' },
  failed: { label: 'Failed', tone: 'down' },
  budget_exhausted: { label: 'Budget spent', tone: 'neutral' },
  skipped: { label: 'Skipped', tone: 'neutral' },
};

// Why a failed run stopped, from AgentRun.failureReason.
const FAILURE_LABEL: Record<RunFailureReason, string> = {
  rate_limited: 'The provider kept asking to wait, so the run ended without a report.',
  invalid_report: 'The report failed its schema twice, so the run ended without one.',
  error: 'An error ended the run without a report.',
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
  status: (typeof RUN_STATUS)[AgentRun['status']];
  summary: string;
  toolCalls: string;
  tokens: string;
  // The verifier's tokens against its own cap, or null for a run that never verifies.
  verifierTokens: string | null;
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
  // A skip is stored as a run so the gate's reason stays inspectable; it never started.
  if (run.status === 'skipped') {
    return `Skipped by the research gate on the ${eventName} event. ${run.gate.reason}`;
  }
  const started =
    run.trigger === 'investigate'
      ? `Started when you chose Investigate on the ${eventName} event.`
      : `Started by the research gate on the ${eventName} event.`;
  if (!run.startedAt || !run.finishedAt) return started;
  const took = formatDuration(run.finishedAt.getTime() - run.startedAt.getTime());
  const ended = run.failureReason
    ? `Stopped after ${took}. ${FAILURE_LABEL[run.failureReason]}`
    : `Finished in ${took}.`;
  return `${started} ${ended}`;
}

// limits are the free tier limits the api serves for the models the run used.
export function buildRunView(
  run: AgentRun,
  eventName: string,
  limits: readonly FreeTierLimit[],
): RunView {
  const modelSteps = run.steps.flatMap((step) => (step.kind === 'model' ? [step] : []));

  return {
    mode: MODE_LABEL[run.mode],
    status: RUN_STATUS[run.status],
    summary: summary(run, eventName),
    toolCalls: toolCallsLabel(run),
    tokens: `${formatTokens(run.tokensUsed)} of ${formatTokens(run.tokenBudget)}`,
    verifierTokens: run.verification
      ? `${formatTokens(run.verification.tokensUsed)} of ${formatTokens(run.verification.tokenCap)}`
      : null,
    // The research agent picks its model once per run, so the first model step names it.
    model: modelSteps[0]?.model ?? null,
    cost: `$${run.costUsd.toFixed(2)}`,
    steps: run.steps.map((step, index) => ({
      step,
      number: index + 1,
      tone: stepTone(step),
      duration: formatDuration(step.latencyMs),
      tokens: step.kind === 'model' ? `${formatTokens(step.tokens.total)} tok` : null,
    })),
    limits: limits.map((limit) => {
      const tpm = limit.tokensPerMinute.toLocaleString('en-US');
      const rpd = limit.requestsPerDay.toLocaleString('en-US');
      return `${PROVIDER_LABEL[limit.provider]} free tier: ${tpm} tokens per minute, ${rpd} requests per day`;
    }),
    budget: run.verification
      ? `Token budget per run: ${run.tokenBudget.toLocaleString('en-US')} for research, ${run.verification.tokenCap.toLocaleString('en-US')} for the verifier`
      : `Token budget per run: ${run.tokenBudget.toLocaleString('en-US')}`,
  };
}

// The 1-based step the removed claim link opens: the check that removed that claim, or the first
// check that removed any.
export function removingCheckStep(run: AgentRun, claimId?: string): number | null {
  const byClaim =
    claimId === undefined
      ? -1
      : run.steps.findIndex((step) => removedClaimIds(step).includes(claimId));
  const index =
    byClaim === -1 ? run.steps.findIndex((step) => stepTone(step) === 'removed') : byClaim;
  return index === -1 ? null : index + 1;
}

// The run the Agent runs tab opens: the newest that was not skipped, since a Replay often ends in
// skips, or the newest when every run was skipped. Runs arrive newest first.
export function runToOpen(runs: readonly RunSummary[]): RunSummary | undefined {
  return runs.find((run) => run.status !== 'skipped') ?? runs[0];
}

// One row of the Recent runs selector.
export interface RunOption {
  id: string;
  time: string;
  label: string;
  status: (typeof RUN_STATUS)[AgentRun['status']];
}

export function runOption(summary: RunSummary, eventName: string): RunOption {
  return {
    id: summary._id,
    time: formatEtShort(summary.createdAt),
    label: `${eventName}, ${MODE_LABEL[summary.mode].toLowerCase()}`,
    status: RUN_STATUS[summary.status],
  };
}
