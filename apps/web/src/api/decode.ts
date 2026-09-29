import { EventExplain, EventScored, FeedCard, PublicUser, ReportDetail } from '@kesher/shared';

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
export const decodeExplain = (json: unknown): EventExplain => EventExplain.parse(reviveDates(json));
export const decodeUser = (json: unknown): PublicUser => PublicUser.parse(json);
export const decodeScored = (json: unknown): EventScored => EventScored.parse(json);
// A step's input is free form JSON: an ISO string in it stays a string, as the tool received it.
export function decodeReport(json: unknown): ReportDetail {
  const revived = reviveDates(json) as { run?: { steps?: { input?: unknown }[] } };
  const sent = (json as { run?: { steps?: { input?: unknown }[] } } | null)?.run?.steps;
  revived.run?.steps?.forEach((step, index) => {
    step.input = sent?.[index]?.input;
  });
  return ReportDetail.parse(revived);
}
