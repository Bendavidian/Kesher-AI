import type { AgentRun } from '@kesher/shared';

// Research budgets (SPEC.md Research agent, decision log T08 and T13). The step budget counts
// tool calls. The token budget replaced the first 6,000 once research moved to Gemini, where the
// history resent on every turn fits the free tier easily, and grew with the seven MCP tools of
// T13, whose schemas go out on every turn. Gemini's free tier limits requests, not daily tokens.
// T16 tunes both.
export type RunMode = AgentRun['mode'];

export const STEP_BUDGET: Record<RunMode, number> = { auto: 6, deep: 15 };
export const TOKEN_BUDGET: Record<RunMode, number> = { auto: 16_000, deep: 32_000 };

// Kept for the report's output. A tool turn gets the same output cap, so a report the model
// submits early is not cut short.
export const REPORT_RESERVE_TOKENS = 1_500;
export const TURN_OUTPUT_TOKENS = REPORT_RESERVE_TOKENS;
// What a tool turn adds to the next prompt: the call itself, and one tool result of up to 10
// search_news items of about 750 characters.
export const TOOL_CALL_TOKENS = 200;
export const TOOL_RESULT_ALLOWANCE_TOKENS = 2_000;
// Below this, a report would be cut off, so the run stops instead.
export const MIN_REPORT_OUTPUT_TOKENS = 500;

// About 4 characters per token, as in the model client.
export const estimateTokens = (text: string) => Math.ceil(text.length / 4);

export interface TurnState {
  stepBudget: number;
  tokenBudget: number;
  toolCallsUsed: number;
  tokensUsed: number;
  // The estimated input of the next call: system, tools and the history so far.
  promptTokens: number;
}

export type TurnPlan =
  | { kind: 'tools'; maxOutputTokens: number }
  | { kind: 'report'; reason: 'step_budget' | 'token_budget'; maxOutputTokens: number }
  | { kind: 'stop' };

// Code decides every turn. A call starts only when its estimated input and its output cap fit
// in what remains, and a tool turn only when a report can still follow it.
export function planTurn(state: TurnState): TurnPlan {
  const remaining = state.tokenBudget - state.tokensUsed;
  const toolTurn = state.promptTokens + TURN_OUTPUT_TOKENS;
  const reportAfterToolTurn =
    state.promptTokens + TOOL_CALL_TOKENS + TOOL_RESULT_ALLOWANCE_TOKENS + REPORT_RESERVE_TOKENS;
  const toolsLeft = state.toolCallsUsed < state.stepBudget;

  if (toolsLeft && toolTurn + reportAfterToolTurn <= remaining) {
    return { kind: 'tools', maxOutputTokens: TURN_OUTPUT_TOKENS };
  }
  const reportOutput = Math.min(REPORT_RESERVE_TOKENS, remaining - state.promptTokens);
  if (reportOutput < MIN_REPORT_OUTPUT_TOKENS) return { kind: 'stop' };
  return {
    kind: 'report',
    reason: toolsLeft ? 'token_budget' : 'step_budget',
    maxOutputTokens: reportOutput,
  };
}
