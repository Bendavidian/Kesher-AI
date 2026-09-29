import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { DEMO_PASSWORD, DEMO_PERSONAS, type PersonaKey } from '@kesher/shared';
import type { Db } from 'mongodb';
import { createApp } from '../app';
import { SESSION_COOKIE } from '../auth/session';
import { createModelClient, MODELS, type ModelClient } from '../llm/client';
import type { ModelRecording } from '../llm/recordings';
import { createRealtime, type Realtime } from '../realtime/socket';
import { mockModel, resolveMocks } from './models';

export const TEST_JWT_SECRET = 'test-jwt-secret-that-is-at-least-32-chars';

const quiet = () => undefined;

// The recorded answers for the demo item, replayed; no test calls a provider.
export function recordedModels(recorded: ModelRecording): () => ModelClient {
  return () => {
    const guard = mockModel(MODELS.screen.model, recorded.screen.chunks);
    const groq = mockModel(MODELS.extraction.model, [recorded.extraction.text]);
    return createModelClient({
      resolve: resolveMocks({ [guard.modelId]: guard, [groq.modelId]: groq }),
    });
  };
}

// A model client with no models at all: any call fails the step that made it.
export const noModels = () => createModelClient({ resolve: resolveMocks({}) });

export interface TestApi {
  url: string;
  realtime: Realtime;
  close(): Promise<void>;
}

// The api as server.ts builds it: routes, sign in and Socket.IO on one HTTP server, port 0.
export async function startApi(
  db: Db,
  { models = noModels, devRoutes = true }: { models?: () => ModelClient; devRoutes?: boolean } = {},
): Promise<TestApi> {
  const app = createApp({
    db,
    devRoutes,
    auth: {
      secret: TEST_JWT_SECRET,
      secureCookie: false,
      onSignOut: (userId) => realtime.signOut(userId),
    },
    onScored: (eventId, scored) => realtime.publishScored(eventId, scored),
    models,
    log: quiet,
    logError: quiet,
  });
  const server = createServer(app);
  const realtime = createRealtime(server, { db, secret: TEST_JWT_SECRET });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    realtime,
    // Closing Socket.IO closes the HTTP server too.
    close: () => realtime.close(),
  };
}

// Signs in as a seeded persona and returns the Cookie header for later requests.
export async function signIn(url: string, key: PersonaKey): Promise<string> {
  const email = DEMO_PERSONAS.find((persona) => persona.key === key)!.email;
  const response = await fetch(`${url}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: DEMO_PASSWORD }),
  });
  if (response.status !== 200) throw new Error(`sign in as ${key} failed: ${response.status}`);
  const cookie = response.headers
    .getSetCookie()
    .map((header) => header.split(';')[0]!)
    .find((pair) => pair.startsWith(`${SESSION_COOKIE}=`));
  if (!cookie) throw new Error('no session cookie');
  return cookie;
}
