import { RunDetail, RunSummary, type AgentRun, type FreeTierLimit } from '@kesher/shared';
import type { Db } from 'mongodb';
import { collection } from '../db/collections';
import { MODEL_LIMITS, REQUESTS_PER_DAY } from '../llm/limits';

// The run list holds at most this many runs, newest first.
export const RUN_LIST_LIMIT = 50;

// The free tier limits of the models a run's steps used, in order of first use. A model with no
// recorded limits is left out rather than shown with made up numbers.
export function limitsFor(run: Pick<AgentRun, 'steps'>): FreeTierLimit[] {
  const seen = new Set<string>();
  return run.steps.flatMap((step) => {
    if (step.kind !== 'model') return [];
    const key = `${step.provider}:${step.model}`;
    const tpm = MODEL_LIMITS[key]?.tpm;
    const rpd = REQUESTS_PER_DAY[key];
    if (seen.has(key) || tpm === undefined || rpd === undefined) return [];
    seen.add(key);
    return [
      { provider: step.provider, model: step.model, tokensPerMinute: tpm, requestsPerDay: rpd },
    ];
  });
}

// The first company the extraction named, for the summary line; null before an extraction.
async function eventSymbols(db: Db, eventIds: string[]): Promise<Map<string, string | null>> {
  const events = await collection(db, 'market_events')
    .find({ _id: { $in: [...new Set(eventIds)] } }, { projection: { extraction: 1 } })
    .toArray();
  return new Map(
    events.map((event) => [event._id, event.extraction?.companies[0]?.symbol ?? null]),
  );
}

// GET /runs/:runId for the signed in user. null when the run does not exist or belongs to another
// user, so the answer never tells one from the other.
export async function runDetail(db: Db, userId: string, runId: string): Promise<RunDetail | null> {
  const run = await collection(db, 'agent_runs').findOne({ _id: runId, userId });
  if (!run) return null;
  const [report, symbols] = await Promise.all([
    collection(db, 'reports').findOne({ runId }),
    eventSymbols(db, [run.eventId]),
  ]);
  const claims = report
    ? await collection(db, 'claims').find({ reportId: report._id }).toArray()
    : [];
  return RunDetail.parse({
    run,
    reportId: report?._id ?? null,
    claims,
    eventSymbol: symbols.get(run.eventId) ?? null,
    limits: limitsFor(run),
  });
}

// GET /runs: the signed in user's runs, newest first, without their steps.
export async function runList(db: Db, userId: string): Promise<RunSummary[]> {
  const runs = await collection(db, 'agent_runs')
    .find({ userId }, { projection: { steps: 0 } })
    .sort({ createdAt: -1, _id: -1 })
    .limit(RUN_LIST_LIMIT)
    .toArray();
  const symbols = await eventSymbols(
    db,
    runs.map((run) => run.eventId),
  );
  return runs.map((run) =>
    RunSummary.parse({
      _id: run._id,
      eventId: run.eventId,
      eventSymbol: symbols.get(run.eventId) ?? null,
      agent: run.agent,
      mode: run.mode,
      trigger: run.trigger,
      status: run.status,
      tokensUsed: run.tokensUsed,
      createdAt: run.createdAt,
    }),
  );
}
