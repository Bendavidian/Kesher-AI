import { describe, expect, it } from 'vitest';
import { ReportDetail, ReportSource } from './report';

const at = new Date('2026-09-29T12:00:00Z');
const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;

const source = {
  _id: id(1),
  kind: 'news',
  tier: 2,
  title: 'Benzinga via Alpaca',
  citeLabel: 'Benzinga headline',
  ref: 'id 38062166',
};

const run = {
  _id: id(2),
  userId: id(3),
  eventId: id(4),
  agent: 'research',
  mode: 'deep',
  trigger: 'investigate',
  gate: { decision: 'run', reason: 'Investigate' },
  stepBudget: 15,
  tokenBudget: 20_000,
  steps: [],
  tokensUsed: 0,
  costUsd: 0,
  status: 'succeeded',
  failureReason: null,
  startedAt: at,
  finishedAt: at,
  createdAt: at,
};

const claim = {
  _id: id(5),
  reportId: id(6),
  type: 'fact',
  text: 'TSMC paused some production.',
  status: 'unverified',
  checks: [],
  createdAt: at,
  sources: [{ sourceId: id(1), quote: 'TSMC Suspends Chip Production' }],
  premises: [],
};

const detail = {
  report: {
    _id: id(6),
    runId: id(2),
    sections: [{ title: 'Claims', claimIds: [id(5)] }],
    openQuestions: [],
    createdAt: at,
  },
  claims: [claim],
  sources: [source],
  run,
  card: null,
};

describe('ReportSource', () => {
  it('accepts a source label built by code', () => {
    expect(ReportSource.parse(source)).toEqual(source);
  });

  it('never carries the body text or unknown keys', () => {
    expect(ReportSource.safeParse({ ...source, text: 'body' }).success).toBe(false);
  });

  it('rejects blank labels', () => {
    expect(ReportSource.safeParse({ ...source, citeLabel: ' ' }).success).toBe(false);
  });
});

describe('ReportDetail', () => {
  it('accepts a report with its claims, sources, run and no card', () => {
    expect(ReportDetail.parse(detail)).toEqual(detail);
  });

  it('rejects unknown keys', () => {
    expect(ReportDetail.safeParse({ ...detail, userId: id(3) }).success).toBe(false);
  });
});
