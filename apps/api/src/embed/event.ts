import { Embedding, type MarketEvent } from '@kesher/shared';
import type { Db } from 'mongodb';
import { describeError } from '../config/redact';
import { collection } from '../db/collections';
import { MAX_CHUNK_TOKENS, type Embedder } from './local';

// Event vectors for the vector leg of search_news (SPEC.md decision log, T13). An event is
// embedded once, from its headline and the body of its first source, with the same local model
// as the filing chunks. The body is untrusted text; a vector only ranks search results and never
// decides anything (principle 3).

export type LazyEmbedder = () => Promise<Embedder>;

// The headline, then as much of the body as fits the model's 256 word pieces. The cut falls on a
// word boundary, found by halving, so the tokenizer runs about log2(words) times.
export function eventEmbeddingText(
  embedder: Pick<Embedder, 'countTokens'>,
  headline: string,
  body: string | null,
): string {
  const head = headline.trim();
  const words = body?.trim().split(/\s+/).filter(Boolean) ?? [];
  const text = (n: number) => (n === 0 ? head : `${head}. ${words.slice(0, n).join(' ')}`);
  if (embedder.countTokens(text(words.length)) <= MAX_CHUNK_TOKENS) return text(words.length);
  let fits = 0;
  let over = words.length;
  while (over - fits > 1) {
    const mid = Math.floor((fits + over) / 2);
    if (embedder.countTokens(text(mid)) <= MAX_CHUNK_TOKENS) fits = mid;
    else over = mid;
  }
  return text(fits);
}

// Embeds one event whose embedding is still null. The write is conditional, so a concurrent run
// or a backfill never overwrites a vector. Answers whether this call wrote it.
export async function embedEvent(
  db: Db,
  embedder: Embedder,
  event: Pick<MarketEvent, '_id' | 'headline' | 'sourceIds'>,
): Promise<boolean> {
  const source = await collection(db, 'sources').findOne(
    { _id: event.sourceIds[0] },
    { projection: { text: 1 } },
  );
  const [vector] = await embedder.embed([
    eventEmbeddingText(embedder, event.headline, source?.text ?? null),
  ]);
  if (!vector) throw new Error('the embedder returned no vector');
  const { modifiedCount } = await collection(db, 'market_events').updateOne(
    { _id: event._id, embedding: null },
    { $set: { embedding: Embedding.parse(vector) } },
  );
  return modifiedCount === 1;
}

export interface BackfillResult {
  embedded: number;
  failed: number;
}

// Every stored event without a vector, oldest first. Safe to rerun: a second run finds none.
export async function backfillEventEmbeddings(
  db: Db,
  embedder: Embedder,
  log: (message: string) => void = console.log,
): Promise<BackfillResult> {
  const pending = await collection(db, 'market_events')
    .find({ embedding: null }, { projection: { _id: 1, headline: 1, sourceIds: 1 } })
    .sort({ publishedAt: 1, _id: 1 })
    .toArray();
  const result: BackfillResult = { embedded: 0, failed: 0 };
  for (const event of pending) {
    try {
      if (await embedEvent(db, embedder, event)) result.embedded++;
    } catch (error) {
      result.failed++;
      log(`event ${event._id} not embedded: ${describeError(error)}`);
    }
  }
  return result;
}
