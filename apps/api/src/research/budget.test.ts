import { describe, expect, it } from 'vitest';
import {
  MIN_REPORT_OUTPUT_TOKENS,
  planTurn,
  REPORT_RESERVE_TOKENS,
  STEP_BUDGET,
  TOKEN_BUDGET,
  TOOL_CALL_TOKENS,
  TOOL_RESULT_ALLOWANCE_TOKENS,
  TURN_OUTPUT_TOKENS,
} from './budget';

const deep = { stepBudget: STEP_BUDGET.deep, tokenBudget: TOKEN_BUDGET.deep };

describe('budgets', () => {
  it('counts tool calls, 6 in auto and 15 in deep, with 12,000 and 20,000 tokens', () => {
    expect(STEP_BUDGET).toEqual({ auto: 6, deep: 15 });
    expect(TOKEN_BUDGET).toEqual({ auto: 12_000, deep: 20_000 });
    expect(REPORT_RESERVE_TOKENS).toBe(1_500);
  });
});

describe('planTurn', () => {
  it('allows a tool turn while tool calls and tokens remain', () => {
    const turn = planTurn({ ...deep, toolCallsUsed: 0, tokensUsed: 0, promptTokens: 800 });
    expect(turn).toEqual({ kind: 'tools', maxOutputTokens: TURN_OUTPUT_TOKENS });
  });

  it('forces the report once the tool calls are spent', () => {
    const turn = planTurn({ ...deep, toolCallsUsed: 15, tokensUsed: 4_000, promptTokens: 3_000 });
    expect(turn).toEqual({
      kind: 'report',
      reason: 'step_budget',
      maxOutputTokens: REPORT_RESERVE_TOKENS,
    });
  });

  it('forces the report when a tool turn would leave too little for it', () => {
    // A tool turn needs its own prompt and output cap, and afterwards a report turn whose prompt
    // has grown by the tool call and its result, plus the reserve.
    const promptTokens = 2_000;
    const toolTurn = promptTokens + TURN_OUTPUT_TOKENS;
    const reportAfter =
      promptTokens + TOOL_CALL_TOKENS + TOOL_RESULT_ALLOWANCE_TOKENS + REPORT_RESERVE_TOKENS;
    const exact = deep.tokenBudget - toolTurn - reportAfter;

    expect(planTurn({ ...deep, toolCallsUsed: 2, tokensUsed: exact, promptTokens }).kind).toBe(
      'tools',
    );
    expect(planTurn({ ...deep, toolCallsUsed: 2, tokensUsed: exact + 1, promptTokens })).toEqual({
      kind: 'report',
      reason: 'token_budget',
      maxOutputTokens: REPORT_RESERVE_TOKENS,
    });
  });

  it('leaves auto mode room for tool calls on a typical first prompt', () => {
    const auto = { stepBudget: STEP_BUDGET.auto, tokenBudget: TOKEN_BUDGET.auto };
    expect(planTurn({ ...auto, toolCallsUsed: 0, tokensUsed: 0, promptTokens: 1_200 }).kind).toBe(
      'tools',
    );
  });

  it('gives the report only what remains, never more than the reserve', () => {
    const turn = planTurn({ ...deep, toolCallsUsed: 3, tokensUsed: 15_000, promptTokens: 4_000 });
    expect(turn).toEqual({ kind: 'report', reason: 'token_budget', maxOutputTokens: 1_000 });
  });

  it('stops when not even a minimal report fits', () => {
    const promptTokens = 4_000;
    const tokensUsed = deep.tokenBudget - promptTokens - MIN_REPORT_OUTPUT_TOKENS + 1;
    expect(planTurn({ ...deep, toolCallsUsed: 3, tokensUsed, promptTokens })).toEqual({
      kind: 'stop',
    });
  });

  it('stops when the budget is already overspent', () => {
    expect(planTurn({ ...deep, toolCallsUsed: 1, tokensUsed: 21_000, promptTokens: 500 })).toEqual({
      kind: 'stop',
    });
  });
});
