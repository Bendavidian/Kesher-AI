import { parseArgs } from 'node:util';
import { loadEnv } from '../config/env';
import { describeError, redactor } from '../config/redact';
import { connect, DB_NAME } from '../db/client';
import { applyReviews, countRelationships } from './apply';
import { groupRelationships, loadCandidates, loadReviews, pending } from './review';

// npm run graph:apply [-- --dry-run]
// Writes the relationships accepted in data/graph/reviews.json to MONGODB_URI, each with its
// inverse and reviewed: true, removes only the edges of relationships the user rejected, never
// touches the seeded edges, and prints the count of distinct reviewed relationships. --dry-run
// prints the same plan and writes nothing. Safe to run again.

const { values } = parseArgs({ options: { 'dry-run': { type: 'boolean' } } });
const dryRun = values['dry-run'] === true;
const env = loadEnv();
const redact = redactor(env.MONGODB_URI);

const file = await loadCandidates();
const reviews = await loadReviews();
const open = pending(groupRelationships(file), reviews).map((g) => g.key);

const client = await connect(env.MONGODB_URI).catch((error: unknown) => {
  console.error(redact(`Could not connect to MongoDB: ${describeError(error)}`));
  process.exit(1);
});

try {
  const db = client.db(DB_NAME);
  const plan = await applyReviews(db, file, reviews, { dryRun });
  const verb = dryRun ? 'Would' : 'Did';
  console.log(
    `${dryRun ? 'Dry run, nothing written' : 'Applied'}: ${reviews.length} reviews, database ${DB_NAME}.`,
  );
  const list = (label: string, items: string[]) =>
    console.log(`${verb} ${label} ${items.length}${items.length ? `: ${items.join(', ')}` : ''}`);
  list('insert filing Sources', plan.sourcesInserted);
  list('insert edges', plan.inserted);
  list('update edges', plan.updated);
  list('delete edges (rejected)', plan.deleted);
  console.log(
    `Unchanged edges: ${plan.unchanged}. Existing filing Sources reused: ${plan.sourcesExisting}.`,
  );
  const count = await countRelationships(db);
  console.log(
    `${dryRun ? 'Before this apply, distinct' : 'Distinct'} reviewed relationships: ${count.relationships} (${count.seeded} seeded, ${count.t11} from T11), ${count.documents} edge documents.`,
  );
  if (count.missingInverse.length > 0) {
    console.error(`Edges without their inverse: ${count.missingInverse.join(', ')}`);
    process.exitCode = 1;
  }
  if (open.length > 0) {
    console.log(`Not yet decided (${open.length}): ${open.join(', ')}. Run npm run graph:review.`);
  }
} catch (error) {
  console.error(redact(describeError(error)));
  console.error('Nothing is lost by running npm run graph:apply again.');
  process.exitCode = 1;
} finally {
  await client.close();
}
