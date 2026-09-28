import { loadEnv } from '../config/env';
import { DB_NAME, connect } from '../db/client';
import { ensureSearchIndexes } from '../db/indexes';
import { runSeed } from './seed';

// npm run seed: seeds Atlas, then creates the vector search indexes that are missing.
// Safe to run again on either machine.

const env = loadEnv();

// Driver errors can echo the connection string; never print it or its password.
function redact(text: string): string {
  const secrets = [env.MONGODB_URI];
  try {
    const password = new URL(env.MONGODB_URI).password;
    if (password) secrets.push(password, decodeURIComponent(password));
  } catch {
    // Not a parseable URL; the full value is still redacted.
  }
  return secrets.reduce((out, secret) => out.split(secret).join('[REDACTED]'), text);
}

const client = await connect(env.MONGODB_URI).catch((error: unknown) => {
  console.error(redact(`Could not connect to MongoDB: ${String(error)}`));
  process.exit(1);
});

try {
  const db = client.db(DB_NAME);
  const counts = await runSeed(db);
  console.log(`Seeded database ${DB_NAME}:`);
  console.table(counts);
  const searchIndexes = await ensureSearchIndexes(db);
  console.log('Vector search indexes:');
  console.table(searchIndexes);
} catch (error) {
  console.error(redact(error instanceof Error ? (error.stack ?? error.message) : String(error)));
  process.exitCode = 1;
} finally {
  await client.close();
}
