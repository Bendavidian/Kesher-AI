import { loadEnv, loadModelKeys } from '../config/env';
import { describeError, redactor } from '../config/redact';
import { connect, DB_NAME } from '../db/client';
import { collection } from '../db/collections';
import { lazyLocalEmbedder, modelCached } from '../embed/local';
import { loadEvents } from '../eval/dataset';
import { createModelClient, resolveFromKeys, type ModelClient } from '../llm/client';
import { libraryReport, loadLibrary, unscreenedCount } from './library';

// npm run demo:library: loads the 30 real items of the eval set into the kesher database the
// public instance shares, oldest first, through the normal pipeline, with no research gate
// (SPEC.md decision log, T23). About 30 extractions on the Groq free tier the first time; a second
// run finds every item processed and writes nothing. Needs MONGODB_URI and GROQ_API_KEY
// (GOOGLE_GENERATIVE_AI_API_KEY for the fallback), and `npm run seed` done on that database.

// Persona C holds only these; no library event may reach C through any other company.
const C_COMPANIES = ['JNJ', 'KO', 'XOM'];

const env = loadEnv();
const modelKeys = loadModelKeys();
const redact = redactor(env.MONGODB_URI, [modelKeys.groq ?? '', modelKeys.google ?? '']);
const log = (message: string) => console.log(redact(message));

const client = await connect(env.MONGODB_URI).catch((error: unknown) => {
  console.error(redact(`Could not connect to MongoDB: ${describeError(error)}`));
  process.exit(1);
});

let failed = false;
try {
  const db = client.db(DB_NAME);
  if ((await collection(db, 'users').countDocuments()) === 0) {
    throw new Error(`database ${DB_NAME} has no personas; run npm run seed first`);
  }
  const events = await loadEvents();

  let models: ModelClient | undefined;
  const shared = () => (models ??= createModelClient({ resolve: resolveFromKeys(modelKeys) }));
  // Events are embedded at extraction, as in the api, when the local model is cached; otherwise
  // npm run embed:events fills them later.
  const embedder = env.LOCAL_EMBEDDINGS && modelCached() ? lazyLocalEmbedder() : undefined;
  if (!embedder) log('The local embedding model is off or not cached; events keep embedding null.');

  log(`Loading ${events.length} library items into ${DB_NAME}, oldest first.`);
  const result = await loadLibrary(db, events, {
    modelsFor: () => shared,
    ...(embedder ? { embedder } : {}),
    log,
  });
  log(`Loaded ${result.loaded.length}, already there ${result.skipped.length}.`);
  if (result.stopped) {
    failed = true;
    const { id, reason } = result.stopped;
    const why = 'message' in result.stopped ? `: ${result.stopped.message}` : '';
    log(`Stopped at ${id} (${reason}${why}); run again to load the rest in order.`);
  }

  const report = await libraryReport(db, events);
  console.table(
    report.map(({ persona, cards, hidden, eventCompanies, feedCards }) => ({
      persona,
      'library cards': cards,
      'library hidden': hidden,
      'event companies': eventCompanies.join(' '),
      'all cards in the feed': feedCards,
    })),
  );
  const c = report.find((persona) => persona.persona === 'C');
  const onlyC =
    c !== undefined && c.cards > 0 && c.eventCompanies.every((s) => C_COMPANIES.includes(s));
  log(`Persona C sees only KO, JNJ and XOM items: ${onlyC ? 'yes' : 'no'}.`);
  if (!onlyC) failed = true;
  log(`Library sources without a finished injection screen: ${await unscreenedCount(db, events)}.`);
} catch (error) {
  failed = true;
  console.error(redact(describeError(error)));
} finally {
  await client.close();
}
process.exit(failed ? 1 : 0);
