import type { AgentStep } from '@kesher/shared';
import { describe, expect, it } from 'vitest';
import { DEMO_CLAIMS, DEMO_RUN } from '../fixtures/research';
import { jsonTokens } from './json';
import {
  buildRunView,
  formatDuration,
  formatTokens,
  removingCheckStep,
  stepTone,
  toolCallsLabel,
} from './run';

const base = { name: 'x', input: {}, outputSummary: '', latencyMs: 1, startedAt: new Date(0) };
const STEPS: Record<AgentStep['kind'], AgentStep> = {
  code: { kind: 'code', ...base },
  tool: { kind: 'tool', ...base },
  check: { kind: 'check', ...base },
  model: {
    kind: 'model',
    ...base,
    provider: 'groq',
    model: 'openai/gpt-oss-120b',
    tokens: { input: 1, output: 1, total: 2 },
  },
};

describe('stepTone', () => {
  it('follows the step kind', () => {
    expect(stepTone(STEPS.code, 0)).toBe('code');
    expect(stepTone(STEPS.tool, 0)).toBe('tool');
    expect(stepTone(STEPS.model, 1)).toBe('model');
  });

  it('marks a check red only when the report lost a claim', () => {
    expect(stepTone(STEPS.check, 1)).toBe('removed');
    expect(stepTone(STEPS.check, 0)).toBe('code');
  });
});

describe('run formatting', () => {
  it('prints durations in ms below a second and in seconds above', () => {
    expect(formatDuration(3)).toBe('3 ms');
    expect(formatDuration(410)).toBe('410 ms');
    expect(formatDuration(3_900)).toBe('3.9 s');
  });

  it('prints token counts in thousands', () => {
    expect(formatTokens(846)).toBe('846');
    expect(formatTokens(3_480)).toBe('3.5k');
    expect(formatTokens(6_000)).toBe('6k');
  });
});

describe('buildRunView on the demo run', () => {
  const view = buildRunView(DEMO_RUN, DEMO_CLAIMS, 'TSMC');

  it('counts tool calls against the step budget and tokens against the run budget', () => {
    expect(toolCallsLabel(DEMO_RUN)).toBe('5 of 15');
    expect(view.tokens).toBe('5.4k of 6k');
    expect(view.cost).toBe('$0.00');
  });

  it('names the research model and the free tier limits of every model the run used', () => {
    expect(view.model).toBe('gemini-3.5-flash-lite');
    expect(view.limits).toEqual([
      'Gemini free tier: 250,000 tokens per minute, 500 requests per day',
      'Groq free tier: 8,000 tokens per minute, 1,000 requests per day',
    ]);
    expect(view.budget).toBe('Token budget per run: 6,000');
  });

  it('shows tokens only on model steps', () => {
    for (const { step, tokens } of view.steps) {
      expect(tokens !== null).toBe(step.kind === 'model');
    }
  });

  it('points the removed claim link at the check that removed it', () => {
    expect(removingCheckStep(DEMO_RUN, DEMO_CLAIMS)).toBe(9);
    expect(DEMO_RUN.steps[8]?.kind).toBe('check');
  });
});

describe('jsonTokens', () => {
  it('colors keys, strings and numbers, and prints valid JSON', () => {
    const value = { symbol: 'NVDA', count: 3, chunks: [{ id: 'a', section: 'b' }], ok: true };
    const tokens = jsonTokens(value);
    expect(JSON.parse(tokens.map((token) => token.text).join(''))).toEqual(value);
    expect(tokens).toContainEqual({ text: '"symbol"', kind: 'key' });
    expect(tokens).toContainEqual({ text: '"NVDA"', kind: 'string' });
    expect(tokens).toContainEqual({ text: '3', kind: 'number' });
  });

  it('keeps short nested objects on one line', () => {
    const text = jsonTokens({ chunks: [{ id: 'a', section: 'b' }] })
      .map((token) => token.text)
      .join('');
    expect(text).toBe('{\n  "chunks": [ { "id": "a", "section": "b" } ]\n}');
  });
});
