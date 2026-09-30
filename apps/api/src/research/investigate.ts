import type { FeedItem } from '@kesher/shared';
import { collection } from '../db/collections';
import { enqueueResearch, type ResearchJobDeps } from './enqueue';
import { reserveGuestRun, type Reservation } from './dailyBudget';
import { guestInvestigateReason, investigateReason } from './gate';

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
// state queued. userId comes from the auth context only. A guest's run is one per UTC day and
// comes from the guests' share of the budget (SPEC.md decision log, T24).
export async function startInvestigation(
  deps: InvestigateDeps,
  userId: string,
  eventId: string,
): Promise<InvestigateStart> {
  const { db } = deps;
  const user = await collection(db, 'users').findOne(
    { _id: userId },
    { projection: { expiresAt: 1 } },
  );
  const guest = Boolean(user?.expiresAt);
  const result = await enqueueResearch(deps, {
    userId,
    eventId,
    mode: 'deep',
    trigger: 'investigate',
    ...(guest
      ? {
          reserve: (now: Date) => reserveGuestRun(db, userId, now),
          reason: ({ runs, guestRuns }: Reservation) =>
            guestInvestigateReason(runs, guestRuns ?? 0),
        }
      : { reason: ({ runs }: Reservation) => investigateReason(runs) }),
  });
  return result.outcome === 'queued'
    ? { outcome: 'started', item: result.item, done: result.done }
    : result;
}
