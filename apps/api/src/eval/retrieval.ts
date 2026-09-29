import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { NonBlank, UniverseSymbol } from '@kesher/shared';
import type { Db } from 'mongodb';
import { z } from 'zod';
import { collection } from '../db/collections';
import type { Embedder } from '../graph/embed';
import { EVAL_DIR } from './dataset';
import { recallAtK, recallCeiling } from './metrics';

// The retrieval eval (BACKLOG.md T16, note from T11): about 10 queries over the filing chunks,
// each with the chunks the user judged relevant, measured as recall at 3. Part 1 runs it on the
// local MiniLM vectors through $vectorSearch on Atlas, read only; part 2 adds the hybrid search.

export const RETRIEVAL_PATH = resolve(EVAL_DIR, 'retrieval.json');
export const RETRIEVAL_K = 3;
// The pool the user judges: the first results of the same search.
export const JUDGE_POOL = 10;

// A chunk by its filer and index (one 10-K per filer), with the start of its text, so a rebuild
// of the chunks that moves the boundaries is caught instead of silently scoring other text.
export const ChunkRef = z.strictObject({
  key: z.string().regex(/^[A-Z][A-Z0-9.]*#\d+$/),
  excerpt: NonBlank,
});
export type ChunkRef = z.infer<typeof ChunkRef>;

export const RetrievalQuery = z.discriminatedUnion('status', [
  z.strictObject({
    id: z.string().min(1),
    query: NonBlank,
    symbol: UniverseSymbol.nullable(),
    status: z.literal('proposed'),
    relevant: z.array(ChunkRef).length(0),
  }),
  z.strictObject({
    id: z.string().min(1),
    query: NonBlank,
    symbol: UniverseSymbol.nullable(),
    status: z.literal('reviewed'),
    relevant: z.array(ChunkRef),
    decidedAt: z.iso.datetime(),
  }),
]);
export type RetrievalQuery = z.infer<typeof RetrievalQuery>;

export const RetrievalFile = z.strictObject({ queries: z.array(RetrievalQuery).min(1) });

export async function loadRetrievalQueries(path = RETRIEVAL_PATH): Promise<RetrievalQuery[]> {
  return RetrievalFile.parse(JSON.parse(await readFile(path, 'utf8'))).queries;
}

const EXCERPT_CHARS = 80;

export interface ChunkHit {
  key: string;
  excerpt: string;
  symbol: string;
  section: string;
  text: string;
}

export const chunkKey = (symbol: string, chunkIndex: number) => `${symbol}#${chunkIndex}`;
export const excerptOf = (text: string) => text.replace(/\s+/g, ' ').trim().slice(0, EXCERPT_CHARS);

// The same search as npm run graph:search: $vectorSearch on filing_chunks_vector, optionally
// limited to one filer. Reads only.
export async function searchChunks(
  db: Db,
  embedder: Embedder,
  query: string,
  symbol: string | null,
  limit: number,
): Promise<ChunkHit[]> {
  const [queryVector] = await embedder.embed([query]);
  const hits = await collection(db, 'filing_chunks')
    .aggregate<{ symbol: string; section: string; chunkIndex: number; text: string }>([
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
      { $project: { _id: 0, symbol: 1, section: 1, chunkIndex: 1, text: 1 } },
    ])
    .toArray();
  return hits.map((h) => ({
    key: chunkKey(h.symbol, h.chunkIndex),
    excerpt: excerptOf(h.text),
    symbol: h.symbol,
    section: h.section,
    text: h.text,
  }));
}

export interface RetrievalRow {
  id: string;
  query: string;
  symbol: string | null;
  relevant: number;
  found: string[];
  recall: number | null;
  ceiling: number | null;
}

export type RetrievalResult =
  | {
      status: 'ran';
      k: number;
      rows: RetrievalRow[];
      // Queries not judged yet; they count in nothing.
      proposed: string[];
      meanRecall: number | null;
      // Judged chunks whose text no longer starts as it did when judged.
      drift: string[];
    }
  | { status: 'skipped'; reason: string };

export async function runRetrieval(
  db: Db,
  embedder: Embedder,
  queries: readonly RetrievalQuery[],
  k = RETRIEVAL_K,
): Promise<RetrievalResult> {
  const rows: RetrievalRow[] = [];
  const drift: string[] = [];
  const excerpts = new Map<string, string>();
  for (const q of queries) {
    if (q.status !== 'reviewed') continue;
    const hits = await searchChunks(db, embedder, q.query, q.symbol, k);
    for (const hit of hits) excerpts.set(hit.key, hit.excerpt);
    const retrieved = hits.map((h) => h.key).slice(0, k);
    const relevant = q.relevant.map((r) => r.key);
    rows.push({
      id: q.id,
      query: q.query,
      symbol: q.symbol,
      relevant: relevant.length,
      found: relevant.filter((r) => retrieved.includes(r)),
      recall: recallAtK(retrieved, relevant, k),
      ceiling: recallCeiling(relevant.length, k),
    });
  }
  // Every judged chunk is read back by key to check it still holds the judged text.
  for (const q of queries) {
    if (q.status !== 'reviewed') continue;
    for (const ref of q.relevant) {
      const [symbol, index] = ref.key.split('#') as [string, string];
      const excerpt =
        excerpts.get(ref.key) ??
        (await collection(db, 'filing_chunks')
          .find({ symbol: symbol as UniverseSymbol, chunkIndex: Number(index) })
          .project<{ text: string }>({ _id: 0, text: 1 })
          .toArray()
          .then((found) => (found.length === 1 ? excerptOf(found[0]!.text) : null)));
      if (excerpt !== ref.excerpt) drift.push(`${q.id} ${ref.key}`);
    }
  }
  const scored = rows.map((r) => r.recall).filter((r): r is number => r !== null);
  return {
    status: 'ran',
    k,
    rows,
    proposed: queries.filter((q) => q.status === 'proposed').map((q) => q.id),
    meanRecall: scored.length === 0 ? null : scored.reduce((a, b) => a + b, 0) / scored.length,
    drift,
  };
}
