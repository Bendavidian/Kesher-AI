import type { FilingPassage, SearchBackend } from '@kesher/mcp';
import type { Db } from 'mongodb';
import { collection } from '../db/collections';
import type { Embedder } from '../embed/local';
import { fakeEmbedder } from './embedder';

const dot = (a: readonly number[], b: readonly number[]) =>
  a.reduce((sum, x, i) => sum + x * (b[i] ?? 0), 0);

// The Atlas searches over plain mongod, for tests: exact nearest neighbours by dot product (the
// stored vectors are normalized, so this is cosine), ties by chunk order.
export function memorySearch(db: Db, embedder: Embedder = fakeEmbedder()): SearchBackend {
  return {
    async embedQuery(text) {
      const [vector] = await embedder.embed([text]);
      if (!vector) throw new Error('no vector');
      return vector;
    },
    async filingPassages(symbol, vector, limit) {
      const chunks = await collection(db, 'filing_chunks').find({ symbol }).toArray();
      return chunks
        .map((chunk) => ({ chunk, score: dot(chunk.embedding, vector) }))
        .sort(
          (a, b) =>
            b.score - a.score ||
            a.chunk.sourceId.localeCompare(b.chunk.sourceId) ||
            a.chunk.chunkIndex - b.chunk.chunkIndex,
        )
        .slice(0, limit)
        .map(({ chunk }): FilingPassage => ({
          sourceId: chunk.sourceId,
          symbol: chunk.symbol,
          form: chunk.form,
          section: chunk.section,
          chunkIndex: chunk.chunkIndex,
          text: chunk.text,
        }));
    },
  };
}
