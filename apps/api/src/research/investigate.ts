import { randomUUID } from 'node:crypto';
import type { FeedItem, FeedResearch } from '@kesher/shared';
import { collection } from '../db/collections';
import type { ModelClient } from '../llm/client';
import { runResearch, type ResearchDeps } from './agent';

// Investigate (SPEC.md Pipeline): a second entry point into the research path, started by the
// signed in user. It skips the relevance and importance conditions of the gate but not the
// budget; the daily budget lands in T12, and its check belongs in startInvestigation.

export const INVESTIGATE_GATE_REASON =
  'Investigate skips the relevance and importance conditions; the daily budget lands in T12.';

// A run older than this is taken as lost, for example to an api restart, and may be started
// again. Deep runs take seconds; with every 429 wait allowed they stay well under it. The clock
// is the item's updatedAt, which a rescore also moves, so a rescore only postpones a takeover.
// Taking over at request time, not at startup, keeps a second machine on the same database from
// failing runs that are still going.
export const STALE_RESEARCH_MS = 15 * 60 * 1000;

export interface InvestigateDeps extends Omit<ResearchDeps, 'models' | 'newId'> {
  models: () => ModelClient;
  // Called after each research state change of the item, for feed:update.
  onResearch?: (item: FeedItem) => Promise<void> | void;
  // Where a background failure goes, redacted by the server.
  logError?: (error: unknown) => void;
}

export type InvestigateStart =
  | { outcome: 'started'; item: FeedItem; done: Promise<void> }
  | { outcome: 'no_path' }
  | { outcome: 'already_running' };

// Starts one deep research run for the user on the event and returns at once; the run goes on in
// the background (T12 moves it to the job queue). userId comes from the auth context only.
// The item moves to running with the new run's id in one conditional write, so two requests
// never start two runs. When the run ends, the item is done with its report or failed.
export async function startInvestigation(
  deps: InvestigateDeps,
  userId: string,
  eventId: string,
): Promise<InvestigateStart> {
  const { db, onResearch, logError = () => undefined } = deps;
  const now = deps.now ?? Date.now;
  const items = collection(db, 'feed_items');
  const runId = randomUUID();
  const startedAt = new Date(now());
  const running: FeedResearch = { state: 'running', runId, reportId: null };

  const item = await items.findOneAndUpdate(
    {
      userId,
      eventId,
      path: { $ne: null },
      $or: [
        { 'research.state': { $nin: ['queued', 'running'] } },
        { updatedAt: { $lt: new Date(startedAt.getTime() - STALE_RESEARCH_MS) } },
      ],
    },
    { $set: { research: running, updatedAt: startedAt } },
    { returnDocument: 'after' },
  );
  if (!item) {
    const shown = await items.findOne({ userId, eventId, path: { $ne: null } });
    return { outcome: shown ? 'already_running' : 'no_path' };
  }

  // A push that fails is logged and never stops the run or its final state.
  const publish = async (changed: FeedItem) => {
    try {
      await onResearch?.(changed);
    } catch (error) {
      logError(error);
    }
  };

  // Only this run's state is replaced: a reset or a newer run leaves the item alone. A failed
  // write is tried once more; after that the item waits for the stale takeover.
  const settle = async (research: FeedResearch) => {
    const write = () =>
      items.findOneAndUpdate(
        { _id: item._id, 'research.runId': runId, 'research.state': 'running' },
        { $set: { research, updatedAt: new Date(now()) } },
        { returnDocument: 'after' },
      );
    const settled = await write().catch(write);
    if (settled) await publish(settled);
  };

  const done = (async () => {
    await publish(item);
    let research: FeedResearch;
    try {
      const outcome = await runResearch(
        { ...deps, models: deps.models() },
        {
          userId,
          eventId,
          mode: 'deep',
          trigger: 'investigate',
          gateReason: INVESTIGATE_GATE_REASON,
          runId,
        },
      );
      research = outcome.reportId
        ? { state: 'done', runId, reportId: outcome.reportId }
        : { state: 'failed', runId, reportId: null };
    } catch (error) {
      logError(error);
      // A run that failed before it was stored, such as a reset in between, names no run. If
      // even that read fails, the card names no run rather than one that may not exist.
      const stored = await collection(db, 'agent_runs')
        .countDocuments({ _id: runId })
        .catch(() => 0);
      research = { state: 'failed', runId: stored > 0 ? runId : null, reportId: null };
    }
    await settle(research);
  })().catch((error: unknown) => {
    logError(new Error(`research run ${runId} did not settle`, { cause: error }));
  });

  return { outcome: 'started', item, done };
}
