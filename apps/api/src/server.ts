import { z } from 'zod';
import { createApp } from './app';
import { loadEnv } from './config/env';
import { describeError, redactor } from './config/redact';
import { DB_NAME, connect } from './db/client';
import { ensureCollections, ensureIndexes } from './db/indexes';

const port = z.coerce.number().int().min(1).max(65535).default(3001).parse(process.env.PORT);
const env = loadEnv();
const redact = redactor(env.MONGODB_URI);

const client = await connect(env.MONGODB_URI).catch((error: unknown) => {
  console.error(redact(`Could not connect to MongoDB: ${describeError(error)}`));
  process.exit(1);
});
const db = client.db(DB_NAME);
// Idempotent. Ingest relies on the unique indexes; search indexes stay with npm run seed.
await ensureCollections(db);
await ensureIndexes(db);

const devRoutes = env.NODE_ENV !== 'production';
const server = createApp({
  db,
  devRoutes,
  logError: (error) => console.error(redact(describeError(error))),
}).listen(port, () => {
  console.log(
    `api listening on http://localhost:${port}, database ${DB_NAME}, dev routes ${devRoutes ? 'on' : 'off'}`,
  );
});

function shutdown() {
  server.close(() => {
    void client.close().finally(() => process.exit(0));
  });
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
