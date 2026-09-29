import type { AgentStep } from '@kesher/shared';
import { describe, expect, it } from 'vitest';
import { MODEL_LIMITS, REQUESTS_PER_DAY } from '../llm/limits';
import { limitsFor } from './runs';

const at = new Date('2026-09-29T12:00:00Z');
const base = {
  input: {},
  outputSummary: '',
  output: '',
  outputTruncated: false,
  latencyMs: 1,
  startedAt: at,
};
const tokens = { input: 1, output: 1, total: 2 };
const model = (provider: 'google' | 'groq', name: string): AgentStep => ({
  kind: 'model',
  name: 'Research turn',
  ...base,
  provider,
  model: name,
  tokens,
});

describe('limitsFor', () => {
  it('lists each model the steps used once, in order of first use', () => {
    const steps: AgentStep[] = [
      { kind: 'code', name: 'Gate check', ...base },
      model('google', 'gemini-3.5-flash-lite'),
      { kind: 'tool', name: 'get_event', ...base },
      model('google', 'gemini-3.5-flash-lite'),
      model('groq', 'openai/gpt-oss-120b'),
    ];
    expect(limitsFor({ steps })).toEqual([
      {
        provider: 'google',
        model: 'gemini-3.5-flash-lite',
        tokensPerMinute: 250_000,
        requestsPerDay: 500,
      },
      {
        provider: 'groq',
        model: 'openai/gpt-oss-120b',
        tokensPerMinute: 8_000,
        requestsPerDay: 1_000,
      },
    ]);
  });

  it('leaves out a model with no recorded limits, and a run with no model step', () => {
    expect(limitsFor({ steps: [model('groq', 'some-other-model')] })).toEqual([]);
    expect(limitsFor({ steps: [] })).toEqual([]);
  });
});

describe('the limit tables', () => {
  it('name the same models, so the footer never drops one the limiter knows', () => {
    expect(Object.keys(REQUESTS_PER_DAY).sort()).toEqual(Object.keys(MODEL_LIMITS).sort());
  });
});
