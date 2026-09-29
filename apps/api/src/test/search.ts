import { matchedTerms, queryTerms, type FilingPassage, type SearchBackend } from '@kesher/mcp';
import type { Db } from 'mongodb';
import { collection } from '../db/collections';
import type { Embedder } from '../embed/local';
import { fakeEmbedder } from './embedder';

const dot = (a: readonly number[], b: readonly number[]) =>
  a.reduce((sum, x, i) => sum + x * (b[i] ?? 0), 0);

// The Atlas searches over plain mongod, for tests: exact nearest neighbours by dot product (the
// stored vectors are normalized, so this is cosine), and for the text list a keyword match
// ranked by distinct words matched, then recency, in place of Atlas Search.
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
    async newsText(query, { symbols, since }, limit) {
      const terms = queryTerms(query);
      const news = await collection(db, 'sources')
        .find({
          kind: 'news',
          ...(symbols ? { symbols: { $in: [...symbols] } } : {}),
          ...(since ? { publishedAt: { $gte: since } } : {}),
        })
        .toArray();
      return news
        .map((doc) => ({ doc, matched: matchedTerms(doc.title, doc.text, terms) }))
        .filter(({ matched }) => matched > 0)
        .sort(
          (a, b) =>
            b.matched - a.matched ||
            b.doc.publishedAt.getTime() - a.doc.publishedAt.getTime() ||
            a.doc._id.localeCompare(b.doc._id),
        )
        .slice(0, limit)
        .map(({ doc }) => doc._id);
    },
    async eventVectors(vector, limit) {
      const events = await collection(db, 'market_events')
        .find({ embedding: { $ne: null } }, { projection: { _id: 1, embedding: 1 } })
        .toArray();
      return events
        .map((event) => ({ id: event._id, score: dot(event.embedding ?? [], vector) }))
        .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
        .slice(0, limit)
        .map(({ id }) => id);
    },
  };
}
