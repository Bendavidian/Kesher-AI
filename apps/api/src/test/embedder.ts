import { EMBEDDING_DIMENSIONS } from '@kesher/shared';
import type { Embedder } from '../embed/local';

// A stand in for the local model in tests: a word piece per word plus [CLS] and [SEP], and a
// one hot vector per text, so the same text always gives the same vector and tests never load
// or download the model.
export function fakeEmbedder(): Embedder & { embedded: string[] } {
  const embedded: string[] = [];
  return {
    embedded,
    countTokens: (text) => text.split(/\s+/).filter(Boolean).length + 2,
    embed(texts) {
      embedded.push(...texts);
      return Promise.resolve(texts.map((text) => oneHot(text)));
    },
  };
}

export function oneHot(text: string): number[] {
  let hash = 0;
  for (const char of text) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) % EMBEDDING_DIMENSIONS;
  return Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => (i === hash ? 1 : 0));
}
