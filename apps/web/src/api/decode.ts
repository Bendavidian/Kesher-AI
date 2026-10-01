import {
  EventScored,
  FeedCard,
  HiddenFeed,
  IngestStatus,
  PublicUser,
  ReportDetail,
  RunDetail,
  RunEnded,
  RunStepPushed,
  RunSummary,
} from '@kesher/shared';

// Dates travel as ISO strings over JSON and Socket.IO (docs/INTERFACES.md). They become Dates
// before the shared schemas parse them, so the web holds the same types as the api.
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

export function reviveDates(value: unknown): unknown {
  if (typeof value === 'string') return ISO_DATE_TIME.test(value) ? new Date(value) : value;
  if (Array.isArray(value)) return value.map(reviveDates);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, inner]) => [key, reviveDates(inner)]),
    );
  }
  return value;
}

export const decodeFeedCard = (json: unknown): FeedCard => FeedCard.parse(reviveDates(json));
export function decodeFeed(json: unknown): FeedCard[] {
  if (!Array.isArray(json)) throw new Error('the feed is not a list');
  return json.map(decodeFeedCard);
}
export const decodeHidden = (json: unknown): HiddenFeed => HiddenFeed.parse(reviveDates(json));
export const decodeIngestStatus = (json: unknown): IngestStatus =>
  IngestStatus.parse(reviveDates(json));
// A guest's user carries expiresAt (T24).
export const decodeUser = (json: unknown): PublicUser => PublicUser.parse(reviveDates(json));
export const decodeScored = (json: unknown): EventScored => EventScored.parse(json);
// A step's input is free form JSON: an ISO string in it stays a string, as the tool received it.
// Dates are revived everywhere else, then each step's input is put back as sent.
function keepStepInputs(json: unknown, steps: (value: unknown) => unknown[] | undefined): unknown {
  const revived = reviveDates(json);
  const sent = steps(json);
  steps(revived)?.forEach((step, index) => {
    (step as { input?: unknown }).input = (sent?.[index] as { input?: unknown } | undefined)?.input;
  });
  return revived;
}

type WithRun = { run?: { steps?: unknown[] } } | null;
const runSteps = (value: unknown) => (value as WithRun)?.run?.steps;

export const decodeReport = (json: unknown): ReportDetail =>
  ReportDetail.parse(keepStepInputs(json, runSteps));
export const decodeRun = (json: unknown): RunDetail =>
  RunDetail.parse(keepStepInputs(json, runSteps));
export function decodeRuns(json: unknown): RunSummary[] {
  if (!Array.isArray(json)) throw new Error('the run list is not a list');
  return json.map((row) => RunSummary.parse(reviveDates(row)));
}
export const decodeRunStep = (json: unknown): RunStepPushed =>
  RunStepPushed.parse(
    keepStepInputs(json, (value) => {
      const step = (value as { step?: unknown } | null)?.step;
      return step === undefined ? undefined : [step];
    }),
  );
export const decodeRunEnded = (json: unknown): RunEnded => RunEnded.parse(json);
