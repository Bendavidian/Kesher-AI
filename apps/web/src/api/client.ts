import {
  DEMO_PASSWORD,
  DEMO_PERSONAS,
  DemoReplayResponse,
  type EventExplain,
  type FeedCard,
  type PersonaKey,
  type PublicUser,
  type ReportDetail,
  type RunDetail,
  type RunSummary,
} from '@kesher/shared';
import {
  decodeExplain,
  decodeFeed,
  decodeFeedCard,
  decodeReport,
  decodeRun,
  decodeRuns,
  decodeUser,
} from './decode';

// The api as the feed screen uses it (docs/INTERFACES.md). The dev server proxies /api to it, so
// the session cookie stays first party. No call names a user: the cookie is the identity.
export interface KesherApi {
  // The persona switcher: a demo control over the seeded users, not authentication (docs/UI.md).
  signInAs(key: PersonaKey): Promise<PublicUser>;
  // The signed in user, from the session cookie.
  me(): Promise<PublicUser>;
  feed(): Promise<FeedCard[]>;
  explain(eventId: string): Promise<EventExplain>;
  // Starts research on the event for the signed in user; answers with the card, now running.
  investigate(eventId: string): Promise<FeedCard>;
  // One report of the signed in user, with its claims, sources, run and card.
  report(reportId: string): Promise<ReportDetail>;
  // One agent run of the signed in user, with its steps as stored.
  run(runId: string): Promise<RunDetail>;
  // The signed in user's agent runs, newest first.
  runs(): Promise<RunSummary[]>;
  // Demo mode only: the api resets, then replays the pinned demo item, so every open session
  // sees it arrive.
  replayDemo(): Promise<DemoReplayResponse>;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(`/api${path}`, { credentials: 'same-origin', ...init });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
    const message =
      typeof body?.error === 'string' ? body.error : `request failed (${response.status})`;
    throw new ApiError(message, response.status);
  }
  return response.status === 204 ? null : ((await response.json()) as unknown);
}

const post = (path: string, body?: unknown) =>
  request(path, {
    method: 'POST',
    ...(body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });

export const httpApi: KesherApi = {
  async signInAs(key) {
    const email = DEMO_PERSONAS.find((persona) => persona.key === key)!.email;
    return decodeUser(await post('/auth/login', { email, password: DEMO_PASSWORD }));
  },
  async me() {
    return decodeUser(await request('/me'));
  },
  async feed() {
    return decodeFeed(await request('/feed'));
  },
  async explain(eventId) {
    return decodeExplain(await request(`/events/${encodeURIComponent(eventId)}/explain`));
  },
  async investigate(eventId) {
    return decodeFeedCard(await post(`/events/${encodeURIComponent(eventId)}/investigate`));
  },
  async report(reportId) {
    return decodeReport(await request(`/reports/${encodeURIComponent(reportId)}`));
  },
  async run(runId) {
    return decodeRun(await request(`/runs/${encodeURIComponent(runId)}`));
  },
  async runs() {
    return decodeRuns(await request('/runs'));
  },
  async replayDemo() {
    return DemoReplayResponse.parse(await post('/demo/replay'));
  },
};
