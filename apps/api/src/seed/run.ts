import { loadEnv } from '../config/env';
import { describeError, redactor } from '../config/redact';
import { DB_NAME, connect } from '../db/client';
import { ensureSearchIndexes } from '../db/indexes';
import { backfillPublishers, backfillResearchReports, backfillVerification } from './backfill';
import { runSeed } from './seed';

// npm run seed: seeds Atlas, then creates the vector search indexes that are missing.
// Safe to run again on either machine.

const env = loadEnv();
const redact = redactor(env.MONGODB_URI);

const client = await connect(env.MONGODB_URI).catch((error: unknown) => {
  console.error(redact(`Could not connect to MongoDB: ${describeError(error)}`));
  process.exit(1);
});

try {
  const db = client.db(DB_NAME);
  const counts = await runSeed(db);
  console.log(`Seeded database ${DB_NAME}:`);
  console.table(counts);
  console.log(`Sources given a publisher: ${await backfillPublishers(db)}`);
  console.log(`Feed items given a research reportId: ${await backfillResearchReports(db)}`);
  const verification = await backfillVerification(db);
  console.log(
    `Runs given verification null: ${verification.runs}; metric claims given figures: ${verification.claims}`,
  );
  const searchIndexes = await ensureSearchIndexes(db);
  console.log('Search indexes:');
  console.table(searchIndexes);
} catch (error) {
  console.error(redact(describeError(error)));
  process.exitCode = 1;
} finally {
  await client.close();
}
