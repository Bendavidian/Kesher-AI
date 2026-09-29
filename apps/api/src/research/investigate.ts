import type { FeedItem } from '@kesher/shared';
import { enqueueResearch, type ResearchJobDeps } from './enqueue';
import type { Reservation } from './dailyBudget';
import { investigateReason } from './gate';

// Investigate (SPEC.md Pipeline): a second entry point into the research path, started by the
// signed in user. It skips the relevance and importance conditions of the gate but not the
// daily budget.

export { STALE_RESEARCH_MS } from './enqueue';

export type InvestigateDeps = ResearchJobDeps;

export type InvestigateStart =
  | { outcome: 'started'; item: FeedItem; done: Promise<void> }
  | { outcome: 'no_path' }
  | { outcome: 'already_running' }
  | { outcome: 'budget_spent'; reservation: Reservation };

// Queues one deep research run for the user on the event and returns at once, with the item in
// state queued. userId comes from the auth context only.
export async function startInvestigation(
  deps: InvestigateDeps,
  userId: string,
  eventId: string,
): Promise<InvestigateStart> {
  const result = await enqueueResearch(deps, {
    userId,
    eventId,
    mode: 'deep',
    trigger: 'investigate',
    reason: ({ runs }) => investigateReason(runs),
  });
  return result.outcome === 'queued'
    ? { outcome: 'started', item: result.item, done: result.done }
    : result;
}
