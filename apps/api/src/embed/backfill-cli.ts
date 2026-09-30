import { loadEnv } from '../config/env';
import { describeError, redactor } from '../config/redact';
import { connect, DB_NAME } from '../db/client';
import { backfillEventEmbeddings } from './event';
import { localEmbedder } from './local';

// npm run embed:events
// Embeds every MarketEvent in MONGODB_URI whose embedding is still null: events stored before
// extraction embedded them, and any whose embedding failed. Safe to rerun; a second run embeds
// nothing.

const env = loadEnv();
const redact = redactor(env.MONGODB_URI);
const client = await connect(env.MONGODB_URI).catch((error: unknown) => {
  console.error(redact(`Could not connect to MongoDB: ${describeError(error)}`));
  process.exit(1);
});

try {
  const embedder = await localEmbedder();
  const { embedded, failed } = await backfillEventEmbeddings(client.db(DB_NAME), embedder, (m) =>
    console.log(redact(m)),
  );
  console.log(`Embedded ${embedded} event(s); ${failed} failed.`);
  if (failed > 0) process.exitCode = 1;
} catch (error) {
  console.error(redact(`Backfill failed: ${describeError(error)}`));
  process.exitCode = 1;
} finally {
  await client.close();
}
