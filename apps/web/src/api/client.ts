import {
  DEMO_PASSWORD,
  DEMO_PERSONAS,
  DEMO_SOURCE_ID,
  ReplayResponse,
  type EventExplain,
  type FeedCard,
  type PersonaKey,
  type PublicUser,
} from '@kesher/shared';
import { decodeExplain, decodeFeed, decodeUser } from './decode';

// The api as the feed screen uses it (docs/INTERFACES.md). The dev server proxies /api to it, so
// the session cookie stays first party. No call names a user: the cookie is the identity.
export interface KesherApi {
  // The persona switcher: a demo control over the seeded users, not authentication (docs/UI.md).
  signInAs(key: PersonaKey): Promise<PublicUser>;
  feed(): Promise<FeedCard[]>;
  explain(eventId: string): Promise<EventExplain>;
  // Development only: reset, then replay the demo item, so every open session sees it arrive.
  replayDemo(): Promise<ReplayResponse>;
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
  async feed() {
    return decodeFeed(await request('/feed'));
  },
  async explain(eventId) {
    return decodeExplain(await request(`/events/${encodeURIComponent(eventId)}/explain`));
  },
  async replayDemo() {
    // A reset before the first replay has nothing to reset; the replay then processes it.
    await post(`/dev/reset/${DEMO_SOURCE_ID}`).catch((error: unknown) => {
      if (!(error instanceof ApiError && error.status === 404)) throw error;
    });
    return ReplayResponse.parse(await post(`/dev/replay/${DEMO_SOURCE_ID}`));
  },
};
