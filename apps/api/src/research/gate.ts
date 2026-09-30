import type { ResearchState } from '@kesher/shared';
import { AUTO_RUN_LIMIT, DAILY_RUN_LIMIT, GUEST_RUN_LIMIT } from './dailyBudget';

// The research gate (SPEC.md Pipeline): relevance ≥ 0.6, importance ≥ 4, not recent, budget
// left. Code policy only; no model output other than the importance class reaches it, and every
// reason is written here. T16 tunes the thresholds.
export const GATE_MIN_RELEVANCE = 0.6;
export const GATE_MIN_IMPORTANCE = 4;
// "Not recent": one run per user and event cluster in this window, whatever started it.
export const RECENT_RUN_MS = 24 * 60 * 60 * 1000;

// budget is checked after these, with an atomic reservation (dailyBudget.ts).
export type GateCondition =
  'auto_research_off' | 'guest' | 'relevance' | 'importance' | 'active' | 'recent' | 'budget';

export interface GateInput {
  // AUTO_RESEARCH: when off, the gate starts no run and skips every card first.
  autoResearch: boolean;
  // The card belongs to a guest: automatic research never runs for a guest (T24).
  guest: boolean;
  relevance: number;
  importance: number | null;
  researchState: ResearchState;
  // The user's newest run on the event that was not skipped, if any.
  recentRun: { createdAt: Date } | null;
  now: Date;
}

export type GateCheck = { pass: true } | { pass: false; condition: GateCondition; reason: string };

const HOUR_MS = 60 * 60 * 1000;
const score = (value: number) => value.toFixed(2);

function hoursAgo(ms: number): string {
  const hours = Math.floor(ms / HOUR_MS);
  if (hours < 1) return 'less than an hour ago';
  return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
}

// The AUTO_RESEARCH flag, then every condition but the budget, in SPEC.md order; the first one
// that fails is the reason.
export function checkGate({
  autoResearch,
  guest,
  relevance,
  importance,
  researchState,
  recentRun,
  now,
}: GateInput): GateCheck {
  if (!autoResearch) {
    return {
      pass: false,
      condition: 'auto_research_off',
      reason: 'Automatic research is off on this server (AUTO_RESEARCH=false).',
    };
  }
  if (guest) {
    return {
      pass: false,
      condition: 'guest',
      reason: 'Automatic research does not run for guest portfolios; Investigate runs one a day.',
    };
  }
  if (relevance < GATE_MIN_RELEVANCE) {
    return {
      pass: false,
      condition: 'relevance',
      reason: `Relevance ${score(relevance)} is below the gate minimum of ${score(GATE_MIN_RELEVANCE)}.`,
    };
  }
  if (importance === null) {
    return { pass: false, condition: 'importance', reason: 'The event has no importance yet.' };
  }
  if (importance < GATE_MIN_IMPORTANCE) {
    return {
      pass: false,
      condition: 'importance',
      reason: `Importance ${importance} is below the gate minimum of ${GATE_MIN_IMPORTANCE}.`,
    };
  }
  if (researchState === 'queued' || researchState === 'running') {
    return {
      pass: false,
      condition: 'active',
      reason: 'Research on this event is already queued or running for you.',
    };
  }
  if (recentRun) {
    const age = now.getTime() - recentRun.createdAt.getTime();
    if (age < RECENT_RUN_MS) {
      return {
        pass: false,
        condition: 'recent',
        reason: `Research on this event ran for you ${hoursAgo(age)}; the gate waits 24 hours.`,
      };
    }
  }
  return { pass: true };
}

const autoLimits = `automatic runs stop at ${AUTO_RUN_LIMIT} of ${DAILY_RUN_LIMIT}`;

export function gateRunReason({
  relevance,
  importance,
  runs,
}: {
  relevance: number;
  importance: number;
  runs: number;
}): string {
  return (
    `Relevance ${score(relevance)} is at least ${score(GATE_MIN_RELEVANCE)}, ` +
    `importance ${importance} is at least ${GATE_MIN_IMPORTANCE}, ` +
    'no research on this event for you in the last 24 hours, ' +
    `and the daily budget allows it: research run ${runs} today, ${autoLimits}.`
  );
}

export function budgetSkipReason(runs: number): string {
  return `The daily research budget for automatic runs is spent: ${runs} runs today, ${autoLimits}.`;
}

export function investigateReason(runs: number): string {
  return (
    'Investigate skips the relevance and importance conditions, not the daily budget: ' +
    `research run ${runs} of ${DAILY_RUN_LIMIT} today.`
  );
}

export function guestInvestigateReason(runs: number, guestRuns: number): string {
  return (
    `${investigateReason(runs)} A guest portfolio's one run today: ` +
    `guest run ${guestRuns} of ${GUEST_RUN_LIMIT} today.`
  );
}
