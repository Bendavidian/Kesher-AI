import { describe, expect, it } from 'vitest';
import {
  budgetSkipReason,
  checkGate,
  GATE_MIN_IMPORTANCE,
  GATE_MIN_RELEVANCE,
  gateRunReason,
  investigateReason,
  RECENT_RUN_MS,
  type GateInput,
} from './gate';

const now = new Date('2026-09-29T12:00:00Z');
const ago = (ms: number) => new Date(now.getTime() - ms);
const HOUR = 60 * 60 * 1000;

const input = (overrides: Partial<GateInput> = {}): GateInput => ({
  autoResearch: true,
  relevance: 0.8,
  importance: 4,
  researchState: 'none',
  recentRun: null,
  now,
  ...overrides,
});

describe('checkGate', () => {
  it('uses the SPEC.md thresholds: relevance 0.6 and importance 4', () => {
    expect(GATE_MIN_RELEVANCE).toBe(0.6);
    expect(GATE_MIN_IMPORTANCE).toBe(4);
    expect(RECENT_RUN_MS).toBe(24 * HOUR);
  });

  it('passes a relevant, important event with no recent research', () => {
    expect(checkGate(input())).toEqual({ pass: true });
  });

  it('skips every card first with auto_research_off when AUTO_RESEARCH is off', () => {
    expect(checkGate(input({ autoResearch: false }))).toEqual({
      pass: false,
      condition: 'auto_research_off',
      reason: 'Automatic research is off on this server (AUTO_RESEARCH=false).',
    });
    // Before any other condition, so the reason always says why nothing runs.
    expect(checkGate(input({ autoResearch: false, relevance: 0.1, importance: 1 }))).toMatchObject({
      condition: 'auto_research_off',
    });
  });

  it('passes relevance at exactly 0.6 and skips just below it', () => {
    expect(checkGate(input({ relevance: 0.6 }))).toEqual({ pass: true });
    expect(checkGate(input({ relevance: 0.59 }))).toEqual({
      pass: false,
      condition: 'relevance',
      reason: 'Relevance 0.59 is below the gate minimum of 0.60.',
    });
  });

  it('passes importance 4 and 5, and skips 3 or an event with no importance', () => {
    expect(checkGate(input({ importance: 5 }))).toEqual({ pass: true });
    expect(checkGate(input({ importance: 3 }))).toEqual({
      pass: false,
      condition: 'importance',
      reason: 'Importance 3 is below the gate minimum of 4.',
    });
    expect(checkGate(input({ importance: null }))).toEqual({
      pass: false,
      condition: 'importance',
      reason: 'The event has no importance yet.',
    });
  });

  it('skips a card whose research is already queued or running', () => {
    for (const researchState of ['queued', 'running'] as const) {
      expect(checkGate(input({ researchState }))).toEqual({
        pass: false,
        condition: 'active',
        reason: 'Research on this event is already queued or running for you.',
      });
    }
    expect(checkGate(input({ researchState: 'done' }))).toEqual({ pass: true });
    expect(checkGate(input({ researchState: 'failed' }))).toEqual({ pass: true });
  });

  it('skips when a run on this event started within 24 hours, and passes at 24 hours', () => {
    expect(checkGate(input({ recentRun: { createdAt: ago(24 * HOUR - 60_000) } }))).toEqual({
      pass: false,
      condition: 'recent',
      reason: 'Research on this event ran for you 23 hours ago; the gate waits 24 hours.',
    });
    expect(checkGate(input({ recentRun: { createdAt: ago(20 * 60_000) } }))).toMatchObject({
      reason: 'Research on this event ran for you less than an hour ago; the gate waits 24 hours.',
    });
    expect(checkGate(input({ recentRun: { createdAt: ago(HOUR) } }))).toMatchObject({
      reason: 'Research on this event ran for you 1 hour ago; the gate waits 24 hours.',
    });
    expect(checkGate(input({ recentRun: { createdAt: ago(24 * HOUR) } }))).toEqual({
      pass: true,
    });
  });

  it('reports the first condition that fails, in SPEC.md order', () => {
    const everything = input({
      relevance: 0.5,
      importance: 3,
      researchState: 'running',
      recentRun: { createdAt: ago(HOUR) },
    });
    expect(checkGate(everything)).toMatchObject({ condition: 'relevance' });
    expect(checkGate({ ...everything, relevance: 0.8 })).toMatchObject({
      condition: 'importance',
    });
    expect(checkGate({ ...everything, relevance: 0.8, importance: 4 })).toMatchObject({
      condition: 'active',
    });
    expect(
      checkGate({ ...everything, relevance: 0.8, importance: 4, researchState: 'none' }),
    ).toMatchObject({ condition: 'recent' });
  });
});

describe('gate reasons', () => {
  it('names every condition a run passed, and its place in the daily budget', () => {
    expect(gateRunReason({ relevance: 0.8, importance: 4, runs: 3 })).toBe(
      'Relevance 0.80 is at least 0.60, importance 4 is at least 4, no research on this event for you in the last 24 hours, and the daily budget allows it: research run 3 today, automatic runs stop at 20 of 30.',
    );
  });

  it('says why a run was skipped for the budget', () => {
    expect(budgetSkipReason(20)).toBe(
      'The daily research budget for automatic runs is spent: 20 runs today, automatic runs stop at 20 of 30.',
    );
  });

  it('says what Investigate skips and what it does not', () => {
    expect(investigateReason(5)).toBe(
      'Investigate skips the relevance and importance conditions, not the daily budget: research run 5 of 30 today.',
    );
  });
});
