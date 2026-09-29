import { loadEnv, loadSecEnv } from '../config/env';
import { describeError, redactor } from '../config/redact';
import { connect, DB_NAME } from '../db/client';
import { collection } from '../db/collections';
import { filingSource } from './apply';
import { chunkSections, writeChunks } from './chunks';
import { localEmbedder } from './embed';
import { FILERS } from './filers';
import { loadCandidates } from './review';
import { filingHtml, secFetcher, type Fetcher } from './sec';
import { blocks, sections } from './sections';

// npm run graph:chunks
// Splits Item 1 and Item 1A of the 15 10-K filings pinned in data/graph/candidates.json into
// chunks of at most 256 word pieces, embeds them locally and writes them to filing_chunks in
// MONGODB_URI, with their filing Source (inserted once, never modified). Safe to run again: a
// filing whose text did not change is left as it is.

const env = loadEnv();
const redact = redactor(env.MONGODB_URI);
const file = await loadCandidates();
const filings = file.filings.filter((f) => f.form === '10-K');
const TEN_K_FILERS = FILERS.filter((f) => f.form === '10-K').length;
if (filings.length !== TEN_K_FILERS) {
  console.error(`candidates.json pins ${filings.length} 10-K filings, expected ${TEN_K_FILERS}.`);
  process.exit(1);
}

// SEC is asked only for a filing missing from .cache/sec.
let sec: Fetcher | undefined;
const get: Fetcher = (url, accept) =>
  (sec ??= secFetcher(loadSecEnv().SEC_USER_AGENT))(url, accept);

const embedder = await localEmbedder();
const client = await connect(env.MONGODB_URI).catch((error: unknown) => {
  console.error(redact(`Could not connect to MongoDB: ${describeError(error)}`));
  process.exit(1);
});

try {
  const db = client.db(DB_NAME);
  const now = new Date();
  const summary: Record<string, unknown>[] = [];
  for (const filing of filings) {
    const filer = FILERS.find((f) => f.symbol === filing.symbol);
    if (!filer) throw new Error(`no filer ${filing.symbol}`);
    const { html } = await filingHtml(get, filing);
    const chunks = chunkSections(sections(blocks(html), filer.layout), (text) =>
      embedder.countTokens(text),
    );
    const embeddings = await embedder.embed(chunks.map((c) => c.embedText));

    await collection(db, 'sources').updateOne(
      { provider: 'sec_edgar', externalId: filing.accession },
      { $setOnInsert: filingSource(filing, now) },
      { upsert: true },
    );
    const source = await collection(db, 'sources').findOne(
      { provider: 'sec_edgar', externalId: filing.accession },
      { projection: { _id: 1 } },
    );
    if (!source) throw new Error(`no Source for filing ${filing.accession}`);

    const written = await writeChunks(
      db,
      { sourceId: source._id, symbol: filing.symbol },
      chunks,
      embeddings,
      now,
    );
    const tokens = chunks.map((c) => embedder.countTokens(c.embedText));
    summary.push({
      symbol: filing.symbol,
      accession: filing.accession,
      item1: chunks.filter((c) => c.section === 'Item 1').length,
      item1a: chunks.filter((c) => c.section === 'Item 1A').length,
      maxTokens: Math.max(...tokens),
      ...written,
    });
    console.log(`${filing.symbol.padEnd(5)} ${chunks.length} chunks`);
  }
  console.table(summary);
  const total = await collection(db, 'filing_chunks').countDocuments();
  console.log(`filing_chunks in ${DB_NAME}: ${total}`);
} catch (error) {
  console.error(redact(describeError(error)));
  process.exitCode = 1;
} finally {
  await client.close();
}
