import { describe, expect, it } from 'vitest';
import { RunEnded, RunStepPushed } from './realtime';
import { RunDetail, RunSummary } from './runs';

const at = new Date('2026-09-29T12:00:00Z');
const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;

const run = {
  _id: id(1),
  userId: id(2),
  eventId: id(3),
  agent: 'research',
  mode: 'deep',
  trigger: 'investigate',
  gate: { decision: 'run', reason: 'Investigate' },
  stepBudget: 15,
  tokenBudget: 20_000,
  steps: [],
  tokensUsed: 0,
  costUsd: 0,
  status: 'running',
  failureReason: null,
  startedAt: at,
  finishedAt: null,
  createdAt: at,
};

const step = {
  kind: 'tool',
  name: 'get_event',
  input: { eventId: id(3) },
  outputSummary: 'The event.',
  output: '{"_id":"x"}',
  outputTruncated: false,
  latencyMs: 12,
  startedAt: at,
};

const limit = {
  provider: 'google',
  model: 'gemini-3.5-flash-lite',
  tokensPerMinute: 250_000,
  requestsPerDay: 500,
};

describe('RunDetail', () => {
  it('parses a running run with no report yet', () => {
    const detail = { run, reportId: null, claims: [], eventSymbol: 'TSM', limits: [limit] };
    expect(RunDetail.parse(detail)).toEqual(detail);
  });

  it('rejects a user id outside the run and unknown fields', () => {
    expect(
      RunDetail.safeParse({
        run,
        reportId: null,
        claims: [],
        eventSymbol: null,
        limits: [],
        userId: id(2),
      }).success,
    ).toBe(false);
  });
});

describe('RunSummary', () => {
  it('parses a list row and nothing else', () => {
    const row = {
      _id: id(1),
      eventId: id(3),
      eventSymbol: 'TSM',
      agent: 'research',
      mode: 'deep',
      trigger: 'investigate',
      status: 'failed',
      tokensUsed: 1_383,
      createdAt: at,
    };
    expect(RunSummary.parse(row)).toEqual(row);
    expect(RunSummary.safeParse({ ...row, steps: [] }).success).toBe(false);
  });
});

describe('run socket payloads', () => {
  it('carries one stored step with its place in the run', () => {
    const pushed = { runId: id(1), index: 0, step };
    expect(RunStepPushed.parse(pushed)).toEqual(pushed);
    expect(RunStepPushed.safeParse({ ...pushed, index: -1 }).success).toBe(false);
  });

  it('carries the final status', () => {
    expect(RunEnded.parse({ runId: id(1), status: 'succeeded' })).toEqual({
      runId: id(1),
      status: 'succeeded',
    });
    expect(RunEnded.safeParse({ runId: id(1), status: 'done' }).success).toBe(false);
  });
});
