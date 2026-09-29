import { parseArgs } from 'node:util';
import { loadAlpacaKeys, loadEnv, loadModelKeys } from '../config/env';
import { describeError, redactor } from '../config/redact';
import { connect, DB_NAME } from '../db/client';
import { countingClock } from '../extract/recordModels';
import { loadCandidates, loadReviews } from '../graph/review';
import { localEmbedder, modelCached } from '../graph/embed';
import { createModelClient, resolveFromKeys } from '../llm/client';
import type { ModelRecording } from '../llm/recordings';
import { startTestMongo } from '../test/mongo';
import { loadEvents, loadPoisoned } from './dataset';
import {
  loadEvalItems,
  loadModelsOf,
  recordAlpacaItems,
  recordModelAnswers,
  type EvalItem,
} from './items';
import { checkLabels, loadLabels } from './labels';
import { EVALS_PATH, renderReport, writeReport } from './report';
import { loadRetrievalQueries, runRetrieval, type RetrievalResult } from './retrieval';
import { runEval } from './runner';
import { edgeExtractor, summarizeRun } from './summary';

// npm run eval [-- --record] [-- --no-write]
// Replays the T16 eval set through the full pipeline in a fresh kesher_eval database on a local
// mongod, from recorded model answers, and writes the numbers to docs/EVALS.md. --record first
// records whatever is missing, once, on the free tiers: Alpaca items (the Alpaca keys) and the
// screen and extraction answers (the model keys). Without it a missing recording stops the run
// and no provider is called. The retrieval eval reads Atlas (MONGODB_URI) and never writes; it is
// skipped, and the report says so, without MONGODB_URI or the cached embedding model.

const { values } = parseArgs({
  options: { record: { type: 'boolean' }, 'no-write': { type: 'boolean' } },
});
const record = values.record === true;
const log = (message: string) => console.log(message);

const [events, poisoned, labels] = await Promise.all([loadEvents(), loadPoisoned(), loadLabels()]);
const problems = checkLabels(events, labels);
if (problems.length > 0) {
  console.error(`data/evals/labels.json does not match the events:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}

const loaded = await loadEvalItems(events, poisoned);
let { items } = loaded;
const { missing } = loaded;
if (missing.length > 0) {
  if (!record) {
    console.error(`No Alpaca recording for ${missing.join(', ')}; run npm run eval -- --record.`);
    process.exit(1);
  }
  const keys = loadAlpacaKeys();
  if (!keys) {
    console.error('Recording Alpaca items needs ALPACA_API_KEY_ID and ALPACA_API_SECRET_KEY.');
    process.exit(1);
  }
  await recordAlpacaItems(events, missing, keys, log);
  ({ items } = await loadEvalItems(events, poisoned));
}

const unrecorded: EvalItem[] = [];
for (const item of items) if (!(await loadModelsOf(item))) unrecorded.push(item);
if (unrecorded.length > 0) {
  if (!record) {
    console.error(
      `No model recording for ${unrecorded.map((i) => i.id).join(', ')}; run npm run eval -- --record.`,
    );
    process.exit(1);
  }
  const clock = countingClock();
  const client = createModelClient({ resolve: resolveFromKeys(loadModelKeys()), clock });
  log(`Recording the screen and the extraction for ${unrecorded.length} item(s), once.`);
  await recordModelAnswers(unrecorded, client, clock.waitedMs, log);
}

const recordings = new Map<string, ModelRecording>();
for (const item of items) recordings.set(item.id, (await loadModelsOf(item))!);

const mongo = await startTestMongo('kesher_eval');
let run;
try {
  log(`Replaying ${items.length} items in a fresh kesher_eval database.`);
  run = await runEval(mongo.db, items, recordings);
} finally {
  await mongo.stop();
}

async function retrieval(): Promise<RetrievalResult> {
  let uri: string;
  try {
    uri = loadEnv().MONGODB_URI;
  } catch {
    return { status: 'skipped', reason: 'MONGODB_URI is missing or invalid' };
  }
  if (!modelCached()) {
    return { status: 'skipped', reason: 'the embedding model is not in .cache/models' };
  }
  // Any failure here, Atlas down or a search error, skips retrieval with a redacted reason, so the
  // replay's numbers are still written.
  const redact = redactor(uri);
  try {
    const client = await connect(uri);
    try {
      return await runRetrieval(
        client.db(DB_NAME),
        await localEmbedder(),
        await loadRetrievalQueries(),
      );
    } finally {
      await client.close();
    }
  } catch (error) {
    return { status: 'skipped', reason: redact(`retrieval failed: ${describeError(error)}`) };
  }
}

const summary = summarizeRun(
  run,
  labels,
  edgeExtractor(await loadCandidates(), await loadReviews()),
);
const report = renderReport(summary, await retrieval());
if (values['no-write'] === true) {
  console.log(report);
} else {
  await writeReport(report);
  log(`Wrote ${EVALS_PATH}.`);
}
