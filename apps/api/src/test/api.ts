import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  DEMO_PASSWORD,
  DEMO_PERSONAS,
  type FeedItem,
  type LiveStatus,
  type PersonaKey,
  type RunEnded,
  type RunStepPushed,
  SOCKET_EVENTS,
} from '@kesher/shared';
import type { Db } from 'mongodb';
import type { Socket } from 'socket.io-client';
import { createApi } from '../app';
import type { DemoOptions } from '../routes/demo';
import type { GuestOptions } from '../routes/guest';
import { memorySearch } from './search';
import { SESSION_COOKIE } from '../auth/session';
import { createModelClient, MODELS, type ModelClient } from '../llm/client';
import type { ProcessDeps } from '../ingest/process';
import type { ModelRecording } from '../llm/recordings';
import type { PriceReactions } from '../market/reactions';
import { createRealtime, type Realtime } from '../realtime/socket';
import { mockModel, resolveMocks } from './models';

export const TEST_JWT_SECRET = 'test-jwt-secret-that-is-at-least-32-chars';
export const TEST_MCP_SECRET = 'test-mcp-secret-that-is-at-least-32-chars';

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
  // What server.ts hands the live ingester: the pushes, then the gate when research is on.
  afterScoring: ProcessDeps['onScored'];
  // Resolves once every research job queued so far has run, with its last push sent.
  idle(): Promise<void>;
  close(): Promise<void>;
}

// The api as server.ts builds it: routes, sign in and Socket.IO on one HTTP server, port 0.
// research mounts POST /mcp, Investigate and the report routes, as server.ts does.
export async function startApi(
  db: Db,
  {
    models = noModels,
    devRoutes = true,
    demo,
    web,
    research = false,
    autoResearch = true,
    priceReactions,
    guest,
    trustProxy,
    liveStatus,
  }: {
    models?: () => ModelClient;
    devRoutes?: boolean;
    // Mounts POST /demo/replay, as server.ts does with DEMO_MODE on.
    demo?: DemoOptions;
    // Serves this web build with the api under /api, as server.ts does in production.
    web?: string;
    research?: boolean;
    // AUTO_RESEARCH, as server.ts passes it; on by default.
    autoResearch?: boolean;
    // One instance for the routes and the socket pushes, as server.ts passes it.
    priceReactions?: PriceReactions;
    // The clock and limits of the guest routes (T24).
    guest?: GuestOptions;
    // Proxy hops, as server.ts passes 1 in production; tests set X-Forwarded-For with it.
    trustProxy?: number;
    // The live ingester's status, as server.ts passes it where LIVE_INGEST is on.
    liveStatus?: () => LiveStatus | null;
  } = {},
): Promise<TestApi> {
  let url = '';
  const { app, afterScoring, idle } = createApi({
    db,
    devRoutes,
    ...(demo ? { demo } : {}),
    ...(web ? { web } : {}),
    ...(guest ? { guest } : {}),
    ...(trustProxy !== undefined ? { trustProxy } : {}),
    auth: {
      secret: TEST_JWT_SECRET,
      secureCookie: false,
      onSignOut: (userId) => realtime.signOut(userId),
    },
    onScored: (eventId, scored) => realtime.publishScored(eventId, scored),
    models,
    log: quiet,
    logError: quiet,
    ...(priceReactions ? { priceReactions } : {}),
    ...(liveStatus ? { liveStatus } : {}),
    ...(research
      ? {
          mcp: { secret: TEST_MCP_SECRET },
          search: memorySearch(db),
          research: {
            mcpUrl: () => `${url}/mcp`,
            redact: (text: string) => text.split(TEST_MCP_SECRET).join('[REDACTED]'),
            autoResearch,
          },
          onResearch: (item: FeedItem) => realtime.publishItem(item),
          onRunStep: (userId: string, pushed: RunStepPushed) =>
            realtime.publishRunStep(userId, pushed),
          onRunEnd: (userId: string, ended: RunEnded) => realtime.publishRunEnd(userId, ended),
        }
      : {}),
  });
  const server = createServer(app);
  const realtime = createRealtime(server, {
    db,
    secret: TEST_JWT_SECRET,
    ...(priceReactions ? { market: { priceReaction: priceReactions, logError: quiet } } : {}),
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  url = `http://127.0.0.1:${port}`;
  return {
    url,
    realtime,
    afterScoring,
    idle,
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

// The runId of the marker flushPushes sends; no stored run has it.
const FLUSH_RUN_ID = '00000000-0000-4000-8000-00000000f105';

// Resolves once the socket has received every push the api sent its user before the call.
// Socket.IO keeps the order of one connection, so a marker run:end sent now arrives last.
export async function flushPushes(api: TestApi, socket: Socket, userId: string): Promise<void> {
  const arrived = new Promise<void>((resolve) => {
    const onEnd = (ended: { runId?: unknown }) => {
      if (ended.runId !== FLUSH_RUN_ID) return;
      socket.off(SOCKET_EVENTS.runEnd, onEnd);
      resolve();
    };
    socket.on(SOCKET_EVENTS.runEnd, onEnd);
  });
  api.realtime.publishRunEnd(userId, { runId: FLUSH_RUN_ID, status: 'failed' });
  await arrived;
}

// The session cookie a response set, as a Cookie header.
export function sessionCookieOf(response: Response): string {
  const cookie = response.headers
    .getSetCookie()
    .map((header) => header.split(';')[0]!)
    .find((pair) => pair.startsWith(`${SESSION_COOKIE}=`));
  if (!cookie) throw new Error('no session cookie');
  return cookie;
}
