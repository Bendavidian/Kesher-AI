import { parseArgs } from 'node:util';
import { UniverseSymbol } from '@kesher/shared';
import { z } from 'zod';
import { loadEnv } from '../config/env';
import { describeError, redactor } from '../config/redact';
import { connect, DB_NAME } from '../db/client';
import { collection } from '../db/collections';
import { localEmbedder } from '../embed/local';

// npm run graph:search -- "<query>" [--symbol NVDA] [--limit 3]
// Development check of filing retrieval: embeds the query locally and runs $vectorSearch on the
// filing_chunks_vector index in MONGODB_URI. Reads only. Vector scores only rank the results;
// nothing decides on them (SPEC.md Domain model). search_filings over MCP is T13.

const Args = z.object({
  query: z.string().trim().min(1),
  symbol: UniverseSymbol.optional(),
  limit: z.coerce.number().int().min(1).max(10).default(3),
});

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { symbol: { type: 'string' }, limit: { type: 'string' } },
});
const args = Args.safeParse({ query: positionals.join(' '), ...values });
if (!args.success) {
  console.error('Usage: npm run graph:search -- "<query>" [--symbol <ticker>] [--limit 1 to 10]');
  process.exit(1);
}

const env = loadEnv();
if (env.NODE_ENV === 'production') {
  console.error('graph:search is a development check and does not run in production.');
  process.exit(1);
}
const redact = redactor(env.MONGODB_URI);
const { query, symbol, limit } = args.data;

const embedder = await localEmbedder();
const [queryVector] = await embedder.embed([query]);
const client = await connect(env.MONGODB_URI).catch((error: unknown) => {
  console.error(redact(`Could not connect to MongoDB: ${describeError(error)}`));
  process.exit(1);
});

try {
  const hits = await collection(client.db(DB_NAME), 'filing_chunks')
    .aggregate<{
      symbol: string;
      section: string;
      chunkIndex: number;
      text: string;
      score: number;
    }>([
      {
        $vectorSearch: {
          index: 'filing_chunks_vector',
          path: 'embedding',
          queryVector,
          numCandidates: limit * 50,
          limit,
          ...(symbol ? { filter: { symbol } } : {}),
        },
      },
      {
        $project: {
          _id: 0,
          symbol: 1,
          section: 1,
          chunkIndex: 1,
          text: 1,
          score: { $meta: 'vectorSearchScore' },
        },
      },
    ])
    .toArray();
  console.log(`"${query}"${symbol ? ` in ${symbol}` : ''}: ${hits.length} chunk(s)`);
  hits.forEach((hit, i) => {
    console.log(
      `\n${i + 1}. ${hit.symbol} ${hit.section} chunk ${hit.chunkIndex}, score ${hit.score.toFixed(3)}\n   ${hit.text}`,
    );
  });
} catch (error) {
  console.error(redact(describeError(error)));
  process.exitCode = 1;
} finally {
  await client.close();
}
