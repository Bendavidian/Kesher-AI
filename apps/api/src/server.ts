import { z } from 'zod';
import { createApp } from './app';
import { loadEnv, loadMcpEnv, loadModelKeys } from './config/env';
import { describeError, redactor } from './config/redact';
import { DB_NAME, connect } from './db/client';
import { ensureCollections, ensureIndexes } from './db/indexes';
import { createModelClient, resolveFromKeys, type ModelClient } from './llm/client';

const port = z.coerce.number().int().min(1).max(65535).default(3001).parse(process.env.PORT);
const env = loadEnv();
const mcpEnv = loadMcpEnv();
const redact = redactor(env.MONGODB_URI, [mcpEnv.MCP_TOKEN_SECRET]);

const client = await connect(env.MONGODB_URI).catch((error: unknown) => {
  console.error(redact(`Could not connect to MongoDB: ${describeError(error)}`));
  process.exit(1);
});
const db = client.db(DB_NAME);
// Idempotent. Ingest relies on the unique indexes; search indexes stay with npm run seed.
await ensureCollections(db);
await ensureIndexes(db);

// Model keys are read on the first call that needs a model, so the api starts without them.
let modelClient: ModelClient | undefined;
const models = () =>
  (modelClient ??= createModelClient({ resolve: resolveFromKeys(loadModelKeys()) }));

const devRoutes = env.NODE_ENV !== 'production';
const server = createApp({
  db,
  devRoutes,
  mcp: { secret: mcpEnv.MCP_TOKEN_SECRET },
  logError: (error) => console.error(redact(describeError(error))),
  log: (message) => console.log(redact(message)),
  models,
}).listen(port, () => {
  console.log(
    `api listening on http://localhost:${port}, database ${DB_NAME}, mcp on /mcp, dev routes ${devRoutes ? 'on' : 'off'}`,
  );
});

function shutdown() {
  server.close(() => {
    void client.close().finally(() => process.exit(0));
  });
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
