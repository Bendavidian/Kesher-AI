import { DEMO_RUN } from './fixtures/research';

// Client routes. Report and run ids are the stored _id values.

export const FEED_PATH = '/';

export function reportPath(reportId: string): string {
  return `/reports/${reportId}`;
}

// step is 1-based and selects that step in the timeline.
export function runPath(runId: string, step?: number): string {
  return step === undefined ? `/runs/${runId}` : `/runs/${runId}?step=${step}`;
}

// There is no list of runs until T09, so the Agent runs tab opens the demo run.
export const AGENT_RUNS_PATH = runPath(DEMO_RUN._id);
