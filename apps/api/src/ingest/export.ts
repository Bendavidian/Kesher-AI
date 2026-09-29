import { parseArgs } from 'node:util';
import { AccessionNumber, AlpacaNewsId } from '@kesher/shared';
import { loadEnv } from '../config/env';
import { describeError, redactor } from '../config/redact';
import { DB_NAME, connect } from '../db/client';
import { exportRecording } from './recordings';

// npm run recording:export -- --id <alpaca news id | EDGAR accession number> [--force]
// Copies one live recording from the recordings collection to recordings/<provider>/<id>.json,
// so an item picked for the demo or the evals is committed and replays without the database.

const { values } = parseArgs({
  options: { id: { type: 'string' }, force: { type: 'boolean' } },
});
const id = values.id ?? '';
const provider = AlpacaNewsId.safeParse(id).success
  ? 'alpaca'
  : AccessionNumber.safeParse(id).success
    ? 'sec_edgar'
    : null;
if (!provider) {
  console.error(
    'Usage: npm run recording:export -- --id <alpaca news id | EDGAR accession number> [--force]',
  );
  process.exit(1);
}

const env = loadEnv();
const redact = redactor(env.MONGODB_URI);
const client = await connect(env.MONGODB_URI).catch((error: unknown) => {
  console.error(redact(`Could not connect to MongoDB: ${describeError(error)}`));
  process.exit(1);
});

try {
  const result = await exportRecording(client.db(DB_NAME), provider, id, {
    force: values.force ?? false,
  });
  if (result.outcome === 'written') console.log(`Wrote ${result.path}`);
  if (result.outcome === 'exists') {
    console.error(`${result.path} exists; pass --force to write it again.`);
    process.exitCode = 1;
  }
  if (result.outcome === 'missing') {
    console.error(`No live recording for ${provider} ${id} in database ${DB_NAME}.`);
    process.exitCode = 1;
  }
} catch (error) {
  console.error(redact(describeError(error)));
  process.exitCode = 1;
} finally {
  await client.close();
}
