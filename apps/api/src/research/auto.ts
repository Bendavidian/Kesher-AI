import { randomUUID } from 'node:crypto';
import { AgentRun, AgentStep, type FeedItem } from '@kesher/shared';
import { collection } from '../db/collections';
import type { ScoredItem } from '../relevance/feed';
import { STEP_BUDGET, TOKEN_BUDGET } from './budget';
import { enqueueResearch, type ResearchJobDeps } from './enqueue';
import {
  budgetSkipReason,
  checkGate,
  gateRunReason,
  RECENT_RUN_MS,
  type GateCondition,
} from './gate';
import { capStepOutput } from './output';

// Automatic research (SPEC.md Pipeline): after a scoring run has pushed its cards, the gate
// decides for each card above relevance 0 whether research starts. A run goes through the same
// queue as Investigate, in auto mode with trigger gate. A skip is stored as a skipped AgentRun
// with its reason, so Agent Runs shows every decision; relevance 0 writes nothing. When the
// skip is a recent run with a report, that report is attached to the card, with no model call.
export async function autoResearch(
  deps: ResearchJobDeps,
  eventId: string,
  scored: ScoredItem[],
): Promise<void> {
  const { db, redact, logError = () => undefined } = deps;
  const clock = deps.now ?? Date.now;
  const event = await collection(db, 'market_events').findOne(
    { _id: eventId },
    { projection: { extraction: 1 } },
  );
  const importance = event?.extraction?.importance ?? null;

  const publish = async (changed: FeedItem) => {
    try {
      await deps.onResearch?.(changed);
    } catch (error) {
      logError(error);
    }
  };

  const skip = async (
    item: FeedItem,
    condition: GateCondition,
    reason: string,
    now: Date,
  ): Promise<void> => {
    const gateStep = AgentStep.parse({
      kind: 'code',
      name: 'Gate check',
      input: { trigger: 'gate', eventId, relevance: item.relevance, importance },
      outputSummary: reason,
      ...capStepOutput({ decision: 'skip', condition, reason }, redact),
      latencyMs: 0,
      startedAt: now,
    });
    await collection(db, 'agent_runs').insertOne(
      AgentRun.parse({
        _id: randomUUID(),
        userId: item.userId,
        eventId,
        agent: 'research',
        mode: 'auto',
        trigger: 'gate',
        gate: { decision: 'skip', reason },
        stepBudget: STEP_BUDGET.auto,
        tokenBudget: TOKEN_BUDGET.auto,
        steps: [gateStep],
        tokensUsed: 0,
        costUsd: 0,
        status: 'skipped',
        failureReason: null,
        startedAt: null,
        finishedAt: now,
        createdAt: now,
      }),
    );
  };

  // The newest report of the recent runs, put on a card that shows none, for example after a dev
  // reset. The newest run may have failed while an earlier one in the window has a report.
  const attachReport = async (item: FeedItem, runIds: string[], now: Date): Promise<boolean> => {
    const report = await collection(db, 'reports').findOne(
      { runId: { $in: runIds } },
      { sort: { createdAt: -1 }, projection: { _id: 1, runId: 1 } },
    );
    if (!report) return false;
    const runId = report.runId;
    const attached = await collection(db, 'feed_items').findOneAndUpdate(
      { _id: item._id, 'research.state': { $in: ['none', 'failed'] } },
      {
        $set: {
          research: { state: 'done', runId, reportId: report._id },
          updatedAt: now,
        },
      },
      { returnDocument: 'after' },
    );
    if (attached) await publish(attached);
    return attached !== null;
  };

  const decide = async (item: FeedItem): Promise<void> => {
    const now = new Date(clock());
    // Any run that was not skipped counts, a failed one too: a retry is Investigate's (T16 may
    // revisit). This read and the claim below are not one write; the claim alone keeps two runs
    // from going at once, so a run that finishes in between can be followed by another.
    const recentRuns = await collection(db, 'agent_runs')
      .find(
        {
          userId: item.userId,
          eventId,
          status: { $ne: 'skipped' },
          createdAt: { $gt: new Date(now.getTime() - RECENT_RUN_MS) },
        },
        { sort: { createdAt: -1 }, projection: { _id: 1, createdAt: 1 } },
      )
      .toArray();
    const recentRun = recentRuns[0] ?? null;
    const check = checkGate({
      relevance: item.relevance,
      importance,
      researchState: item.research.state,
      recentRun,
      now,
    });
    if (!check.pass) {
      let reason = check.reason;
      if (check.condition === 'recent' && recentRun) {
        const runIds = recentRuns.map((run) => run._id);
        if (await attachReport(item, runIds, now)) {
          reason += ' Its report is attached to the card.';
        }
      }
      await skip(item, check.condition, reason, now);
      return;
    }
    // checkGate skips an event with no importance above.
    if (importance === null) return;

    const result = await enqueueResearch(deps, {
      userId: item.userId,
      eventId,
      mode: 'auto',
      trigger: 'gate',
      reason: ({ runs }) => gateRunReason({ relevance: item.relevance, importance, runs }),
    });
    if (result.outcome === 'already_running') {
      await skip(
        item,
        'active',
        'Research on this event is already queued or running for you.',
        now,
      );
    } else if (result.outcome === 'budget_spent') {
      await skip(item, 'budget', budgetSkipReason(result.reservation.runs), now);
    }
    // no_path: the item lost its path in between, as after a reset; there is nothing to decide.
  };

  // One user's failure never stops the others, and never the pipeline.
  for (const { item } of scored) {
    if (item.relevance <= 0) continue;
    try {
      await decide(item);
    } catch (error) {
      logError(error);
    }
  }
}
