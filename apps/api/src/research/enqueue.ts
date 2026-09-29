import { randomUUID } from 'node:crypto';
import type { AgentRun, FeedItem, FeedResearch } from '@kesher/shared';
import { collection } from '../db/collections';
import { createQueue, type JobQueue } from '../jobs/queue';
import type { ModelClient } from '../llm/client';
import { runResearch, type ResearchDeps } from './agent';
import type { RunMode } from './budget';
import { reserveRun, type Reservation } from './dailyBudget';

// The one path into a research run, for the gate and for Investigate (SPEC.md Pipeline). The
// FeedItem moves to queued, one run is reserved from the daily budget, and the job queue runs it:
// queued, then running, then done with its report or failed. The card never waits for it; each
// change is pushed through onResearch.

// A queued or running item older than this is taken as lost, for example to an api restart, and
// may be started again. Deep runs take seconds; with every 429 wait allowed they stay well under
// it, and so does a short queue. A queue deep enough to keep a job waiting longer lets the next
// Investigate take the card over: the waiting job then finds its claim gone and ends, but its
// reserved run stays counted. The clock is the item's updatedAt, which a rescore also moves,
// so a rescore only postpones a takeover. Taking over at request time, not at startup, keeps a
// second machine on the same database from failing runs that are still going.
export const STALE_RESEARCH_MS = 15 * 60 * 1000;

export interface ResearchJobDeps extends Omit<ResearchDeps, 'models' | 'newId'> {
  models: () => ModelClient;
  // Runs one research job at a time. Without it, each job runs on its own at once.
  queue?: JobQueue;
  // Called after each research state change of the item, for feed:update.
  onResearch?: (item: FeedItem) => Promise<void> | void;
  // Where a background failure goes, redacted by the server.
  logError?: (error: unknown) => void;
}

export interface ResearchJob {
  // From the auth context or the scored FeedItem; never from a model.
  userId: string;
  eventId: string;
  mode: RunMode;
  trigger: AgentRun['trigger'];
  // The gate reason stored on the AgentRun, written by code once the run is reserved.
  reason: (reservation: Reservation) => string;
}

export type EnqueueResult =
  | { outcome: 'queued'; item: FeedItem; done: Promise<void> }
  | { outcome: 'no_path' }
  | { outcome: 'already_running' }
  | { outcome: 'budget_spent'; reservation: Reservation };

export async function enqueueResearch(
  deps: ResearchJobDeps,
  job: ResearchJob,
): Promise<EnqueueResult> {
  const { db, onResearch, logError = () => undefined } = deps;
  const { userId, eventId } = job;
  const now = deps.now ?? Date.now;
  const queue = deps.queue ?? createQueue({ logError });
  const items = collection(db, 'feed_items');
  const runId = randomUUID();
  const queuedAt = new Date(now());

  // One conditional write claims the item, so two requests never start two runs.
  const before = await items.findOneAndUpdate(
    {
      userId,
      eventId,
      path: { $ne: null },
      $or: [
        { 'research.state': { $nin: ['queued', 'running'] } },
        { updatedAt: { $lt: new Date(queuedAt.getTime() - STALE_RESEARCH_MS) } },
      ],
    },
    { $set: { research: { state: 'queued', runId, reportId: null }, updatedAt: queuedAt } },
    { returnDocument: 'before' },
  );
  if (!before) {
    const shown = await items.findOne({ userId, eventId, path: { $ne: null } });
    return { outcome: shown ? 'already_running' : 'no_path' };
  }

  // With no budget left, or no answer from the budget, the item gets back what it had, unless
  // something replaced the claim. Until then a second request sees it queued (409 or active).
  const restore = () =>
    items.updateOne(
      { _id: before._id, 'research.runId': runId, 'research.state': 'queued' },
      { $set: { research: before.research, updatedAt: before.updatedAt } },
    );
  let reservation: Reservation;
  try {
    reservation = await reserveRun(db, job.trigger, queuedAt);
  } catch (error) {
    await restore().catch(logError);
    throw error;
  }
  if (!reservation.reserved) {
    await restore();
    return { outcome: 'budget_spent', reservation };
  }
  const item: FeedItem = {
    ...before,
    research: { state: 'queued', runId, reportId: null },
    updatedAt: queuedAt,
  };
  const gateReason = job.reason(reservation);

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

  const run = async () => {
    // A reset or a takeover while the job waited leaves nothing to run; the reserved run stays
    // counted.
    const running = await items.findOneAndUpdate(
      { _id: item._id, 'research.runId': runId, 'research.state': 'queued' },
      {
        $set: {
          research: { state: 'running', runId, reportId: null },
          updatedAt: new Date(now()),
        },
      },
      { returnDocument: 'after' },
    );
    if (!running) return;
    await publish(running);

    let research: FeedResearch;
    try {
      const outcome = await runResearch(
        { ...deps, models: deps.models() },
        { userId, eventId, mode: job.mode, trigger: job.trigger, gateReason, runId },
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
  };

  const done = publish(item)
    .then(() => queue.push(run))
    .catch((error: unknown) => {
      logError(new Error(`research run ${runId} did not settle`, { cause: error }));
    });

  return { outcome: 'queued', item, done };
}
