import { createServer } from 'node:http';
import { z } from 'zod';
import { createApp } from './app';
import {
  loadAlpacaKeys,
  loadAuthEnv,
  loadEnv,
  loadLiveEnv,
  loadMcpEnv,
  loadModelKeys,
} from './config/env';
import { describeError, redactor } from './config/redact';
import { DB_NAME, connect } from './db/client';
import { ensureCollections, ensureIndexes } from './db/indexes';
import { startLiveIngest, type LiveIngest } from './ingest/live';
import { createModelClient, resolveFromKeys, type ModelClient } from './llm/client';
import { createMarketData } from './market/data';
import { createPriceReactions } from './market/reactions';
import { createRealtime } from './realtime/socket';

const port = z.coerce.number().int().min(1).max(65535).default(3001).parse(process.env.PORT);
const env = loadEnv();
const mcpEnv = loadMcpEnv();
const authEnv = loadAuthEnv();
const modelKeys = loadModelKeys();
const alpacaKeys = loadAlpacaKeys();
// Fails here, naming the missing keys, when LIVE_INGEST is on without them.
const live = loadLiveEnv();
const redact = redactor(env.MONGODB_URI, [
  mcpEnv.MCP_TOKEN_SECRET,
  authEnv.JWT_SECRET,
  modelKeys.groq ?? '',
  modelKeys.google ?? '',
  alpacaKeys?.keyId ?? '',
  alpacaKeys?.secretKey ?? '',
]);

const client = await connect(env.MONGODB_URI).catch((error: unknown) => {
  console.error(redact(`Could not connect to MongoDB: ${describeError(error)}`));
  process.exit(1);
});
const db = client.db(DB_NAME);
// Idempotent. Ingest relies on the unique indexes; search indexes stay with npm run seed.
await ensureCollections(db);
await ensureIndexes(db);

// Model keys are optional: the api starts without them, and a call that needs a missing key
// fails naming it. The client is built on first use.
let modelClient: ModelClient | undefined;
const models = () => (modelClient ??= createModelClient({ resolve: resolveFromKeys(modelKeys) }));

// The price reaction reads the local calendar and bar cache first, and Alpaca only for what they
// lack. The api starts without Alpaca keys; then only uncached market data is unavailable.
const priceReactions = createPriceReactions(createMarketData({ keys: () => alpacaKeys }));
const logError = (error: unknown) => console.error(redact(describeError(error)));

const devRoutes = env.NODE_ENV !== 'production';
const app = createApp({
  db,
  devRoutes,
  mcp: { secret: mcpEnv.MCP_TOKEN_SECRET },
  auth: {
    secret: authEnv.JWT_SECRET,
    secureCookie: env.NODE_ENV === 'production',
    onSignOut: (userId) => realtime.signOut(userId),
  },
  // realtime is created right below; scoring only runs on requests, once the server listens.
  onScored: (eventId, scored) => realtime.publishScored(eventId, scored),
  logError,
  log: (message) => console.log(redact(message)),
  models,
  // Investigate reaches the api's own POST /mcp as a real MCP client.
  research: {
    mcpUrl: () => `http://127.0.0.1:${port}/mcp`,
    redact,
    autoResearch: env.AUTO_RESEARCH,
  },
  onResearch: (item) => realtime.publishItem(item),
  onRunStep: (userId, pushed) => realtime.publishRunStep(userId, pushed),
  onRunEnd: (userId, ended) => realtime.publishRunEnd(userId, ended),
  priceReactions,
});
const server = createServer(app);
const realtime = createRealtime(server, {
  db,
  secret: authEnv.JWT_SECRET,
  market: { priceReaction: priceReactions, logError },
});
// Live ingestion runs on one machine only, where LIVE_INGEST is on (SPEC.md Replay and
// recording). Its scored cards reach the sockets the same way replayed ones do.
let liveIngest: LiveIngest | undefined;
server.listen(port, () => {
  console.log(
    `api listening on http://localhost:${port}, database ${DB_NAME}, mcp on /mcp, socket.io on /socket.io, dev routes ${devRoutes ? 'on' : 'off'}, live ingest ${live.enabled ? 'on' : 'off'}`,
  );
  if (live.enabled) {
    liveIngest = startLiveIngest({
      db,
      models,
      onScored: (eventId, scored) => realtime.publishScored(eventId, scored),
      log: (message) => console.log(redact(message)),
      alpaca: { keys: live.alpaca },
      edgar: { userAgent: live.secUserAgent },
    });
  }
});

// A live item in the middle of a model call gets this long to finish; it resumes on replay.
const LIVE_STOP_TIMEOUT_MS = 10_000;

function shutdown() {
  // Live sources stop first, so no item starts while the sockets and the database close.
  // Closing Socket.IO closes the HTTP server too.
  const liveStopped = Promise.race([
    liveIngest?.stop(),
    new Promise((resolve) => setTimeout(resolve, LIVE_STOP_TIMEOUT_MS).unref()),
  ]);
  void liveStopped
    .then(() => realtime.close())
    .then(() => client.close())
    .finally(() => process.exit(0));
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
