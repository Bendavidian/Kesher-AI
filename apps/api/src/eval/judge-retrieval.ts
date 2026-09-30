import { loadEnv } from '../config/env';
import { describeError, redactor } from '../config/redact';
import { connect, DB_NAME } from '../db/client';
import { writeJson } from '../graph/json';
import { localEmbedder, modelCached } from '../embed/local';
import { printable, type Prompt } from './prompt';
import {
  JUDGE_POOL,
  loadRetrievalQueries,
  RETRIEVAL_PATH,
  searchChunks,
  type ChunkHit,
  type RetrievalQuery,
} from './retrieval';

export type Judgement =
  { kind: 'relevant'; indexes: number[] } | { kind: 'skip' } | { kind: 'quit' };

// Numbers of the relevant results, 1 based, separated by spaces or commas; 0 when none is.
// s skips the query, q quits. null for anything else.
export function parseJudgement(input: string, pool: number): Judgement | null {
  const answer = input.trim().toLowerCase();
  if (answer === 's' || answer === 'skip') return { kind: 'skip' };
  if (answer === 'q' || answer === 'quit') return { kind: 'quit' };
  if (answer === '0') return { kind: 'relevant', indexes: [] };
  const parts = answer.split(/[\s,]+/).filter((p) => p !== '');
  if (parts.length === 0 || parts.some((p) => !/^\d+$/.test(p))) return null;
  const indexes = [...new Set(parts.map(Number))].sort((a, b) => a - b);
  if (indexes.some((i) => i < 1 || i > pool)) return null;
  return { kind: 'relevant', indexes };
}

export function judged(
  query: RetrievalQuery,
  hits: readonly ChunkHit[],
  indexes: readonly number[],
  now: Date,
): RetrievalQuery {
  return {
    id: query.id,
    query: query.query,
    symbol: query.symbol,
    status: 'reviewed',
    relevant: indexes.map((i) => ({ key: hits[i - 1]!.key, excerpt: hits[i - 1]!.excerpt })),
    decidedAt: now.toISOString(),
  };
}

// npm run eval:label -- --retrieval: for each query not judged yet, shows the first results of
// the filing search, in its order and without scores, and records which of them answer the query.
// Recall at 3 then counts how many of those the first three results hold. Reads Atlas only.
export async function judgeRetrieval({ ask }: Prompt, redo: string | undefined): Promise<void> {
  const queries = await loadRetrievalQueries();
  if (redo !== undefined && !queries.some((q) => q.id === redo)) {
    console.error(`No retrieval query ${redo}.`);
    process.exitCode = 1;
    return;
  }
  if (!modelCached()) {
    console.error(
      'The embedding model is not in .cache/models; npm run graph:chunks downloads it.',
    );
    process.exitCode = 1;
    return;
  }
  const { MONGODB_URI } = loadEnv();
  const redact = redactor(MONGODB_URI);
  // Driver errors can echo the URI, so every error leaves here redacted.
  try {
    await judgeWith(MONGODB_URI, queries, redo, ask);
  } catch (error) {
    // Not rethrown: the original error, which may hold the URI, must not reach the terminal.
    console.error(redact(`Retrieval judging failed: ${describeError(error)}`));
    process.exitCode = 1;
  }
}

async function judgeWith(
  uri: string,
  initial: RetrievalQuery[],
  redo: string | undefined,
  ask: Prompt['ask'],
): Promise<void> {
  let queries = initial;
  const client = await connect(uri);
  try {
    const db = client.db(DB_NAME);
    const embedder = await localEmbedder();
    const todo = queries.filter((q) =>
      redo === undefined ? q.status === 'proposed' : q.id === redo,
    );
    console.log(
      `${queries.length} queries, ${queries.length - queries.filter((q) => q.status === 'proposed').length} judged, ${todo.length} to judge.`,
    );
    for (const [n, query] of todo.entries()) {
      const hits = await searchChunks(db, embedder, query.query, query.symbol, JUDGE_POOL);
      console.log(
        `\n${'='.repeat(100)}\n[${n + 1}/${todo.length}] ${query.id}: "${query.query}"${query.symbol ? ` in ${query.symbol}` : ', all filers'}`,
      );
      hits.forEach((hit, i) => {
        console.log(
          `\n${i + 1}. ${hit.symbol} ${printable(hit.section)}, chunk ${hit.key}\n${printable(hit.text)}`,
        );
      });
      let judgement: Judgement | null = null;
      while (judgement === null) {
        const answer = await ask('\nRelevant results (numbers, 0 for none, s skip, q quit): ');
        judgement = answer === null ? { kind: 'quit' } : parseJudgement(answer, hits.length);
        if (judgement === null) console.log(`Answer numbers from 1 to ${hits.length}, 0, s or q.`);
      }
      if (judgement.kind === 'quit') break;
      if (judgement.kind === 'skip') continue;
      const updated = judged(query, hits, judgement.indexes, new Date());
      queries = queries.map((q) => (q.id === query.id ? updated : q));
      await writeJson(RETRIEVAL_PATH, { queries });
      console.log(
        `Saved ${query.id}: ${updated.relevant.map((r) => r.key).join(', ') || 'none relevant'}.`,
      );
    }
  } finally {
    await client.close();
  }
}
