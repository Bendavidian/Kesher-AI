import type { AgentStep } from '@kesher/shared';
import { describe, expect, it } from 'vitest';
import { DEMO_LIMITS, DEMO_RUN } from '../fixtures/research';
import { jsonTokens } from './json';
import {
  buildRunView,
  formatDuration,
  formatTokens,
  outputView,
  removedClaimIds,
  removingCheckStep,
  stepTone,
  tokenScope,
  toolCallsLabel,
  withPushedStep,
} from './run';

const base = {
  name: 'x',
  input: {},
  outputSummary: '',
  output: '',
  outputTruncated: false,
  latencyMs: 1,
  startedAt: new Date(0),
};
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

const CLAIM = '7e1a2b3c-4d5e-4f60-8a71-b2c3d4e5f615';
const check = (output: string, outputTruncated = false): AgentStep => ({
  ...STEPS.check,
  output,
  outputTruncated,
});

describe('stepTone', () => {
  it('follows the step kind', () => {
    expect(stepTone(STEPS.code)).toBe('code');
    expect(stepTone(STEPS.tool)).toBe('tool');
    expect(stepTone(STEPS.model)).toBe('model');
  });

  it('marks a check red only when its output lists a removed claim', () => {
    expect(stepTone(check(JSON.stringify({ removedClaimIds: [CLAIM] })))).toBe('removed');
    expect(stepTone(check(JSON.stringify({ removedClaimIds: [] })))).toBe('code');
    expect(stepTone(check(''))).toBe('code');
  });

  it('reads removed claims only from a whole JSON output of a check', () => {
    const output = JSON.stringify({ removedClaimIds: [CLAIM, 7] });
    expect(removedClaimIds(check(output))).toEqual([CLAIM]);
    expect(removedClaimIds(check(output, true))).toEqual([]);
    expect(removedClaimIds(check('{"removedClaimIds": ['))).toEqual([]);
    expect(removedClaimIds({ ...STEPS.tool, output })).toEqual([]);
  });
});

describe('outputView', () => {
  it('parses whole JSON, keeps anything else as text and notes the cap', () => {
    expect(outputView({ ...STEPS.tool, output: '{"a":1}' })).toEqual({
      format: 'json',
      value: { a: 1 },
      note: null,
    });
    expect(outputView({ ...STEPS.tool, output: '<b>hi</b>' })).toEqual({
      format: 'text',
      text: '<b>hi</b>',
      note: null,
    });
    expect(outputView({ ...STEPS.tool, output: '{"a":1}', outputTruncated: true })).toEqual({
      format: 'text',
      text: '{"a":1}',
      note: 'capped at 8 KB',
    });
    expect(outputView(STEPS.tool)).toEqual({ format: 'none' });
  });
});

describe('tokenScope', () => {
  const issued = (input: Record<string, unknown>): AgentStep => ({
    ...STEPS.code,
    name: 'Run token issued',
    input,
  });
  const runWith = (steps: AgentStep[]) => ({ ...DEMO_RUN, steps });

  it('reads the scope the run token was issued with', () => {
    const step = issued({
      agent: 'research',
      tools: ['get_event', 'search_news'],
      ttlSeconds: 300,
    });
    expect(tokenScope(runWith([step]))).toEqual({
      agent: 'research',
      tools: ['get_event', 'search_news'],
      ttlMinutes: 5,
    });
  });

  it('shows no scope rather than a wrong one', () => {
    expect(tokenScope(runWith([STEPS.code]))).toBeNull();
    const bad = [
      { agent: 'research', tools: ['get_event', 'delete_everything'], ttlSeconds: 300 },
      { agent: 'someone', tools: ['get_event'], ttlSeconds: 300 },
      { agent: 'research', tools: [], ttlSeconds: 300 },
      { agent: 'research', tools: ['get_event'] },
    ];
    for (const input of bad) expect(tokenScope(runWith([issued(input)]))).toBeNull();
  });
});

describe('withPushedStep', () => {
  const run = { ...DEMO_RUN, steps: DEMO_RUN.steps.slice(0, 7), tokensUsed: 0 };

  it('appends the next step and counts its tokens', () => {
    const next = withPushedStep(run, { runId: run._id, index: 7, step: DEMO_RUN.steps[7]! });
    if (next === 'gap') throw new Error('expected a run');
    expect(next.steps).toHaveLength(8);
    expect(next.tokensUsed).toBe(3_480);
  });

  it('ignores a step it holds and reports a gap past the next one', () => {
    expect(withPushedStep(run, { runId: run._id, index: 3, step: DEMO_RUN.steps[3]! })).toBe(run);
    expect(withPushedStep(run, { runId: run._id, index: 9, step: DEMO_RUN.steps[9]! })).toBe('gap');
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
  const view = buildRunView(DEMO_RUN, 'TSMC', DEMO_LIMITS);

  it('counts tool calls against the step budget and tokens against the run budget', () => {
    expect(toolCallsLabel(DEMO_RUN)).toBe('5 of 15');
    expect(view.tokens).toBe('5.4k of 6k');
    expect(view.cost).toBe('$0.00');
  });

  it('names the research model and the free tier limits the api served', () => {
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
    expect(removingCheckStep(DEMO_RUN)).toBe(9);
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
