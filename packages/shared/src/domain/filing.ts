import { z } from 'zod';
import { Embedding, Id, NonBlank } from './common';
import { UniverseSymbol } from './universe';

export const FilingForm = z.enum(['10-K', '10-Q', '8-K', '20-F', '6-K']);
export type FilingForm = z.infer<typeof FilingForm>;

// One chunk of a filing section for RAG. Chunks hold at most 256 tokens; T11 counts tokens,
// and the character cap here is only a guard.
export const FilingChunk = z.strictObject({
  _id: Id,
  sourceId: Id,
  symbol: UniverseSymbol,
  form: FilingForm,
  section: NonBlank,
  chunkIndex: z.int().min(0),
  text: NonBlank.max(2000),
  embedding: Embedding,
  createdAt: z.date(),
});
export type FilingChunk = z.infer<typeof FilingChunk>;
