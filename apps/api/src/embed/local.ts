import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { EMBEDDING_DIMENSIONS } from '@kesher/shared';

// Local embeddings, SPEC.md Stack: Xenova/all-MiniLM-L6-v2 through @huggingface/transformers, 384
// dimensions, mean pooled and normalized for cosine. No key, no quota, no network after the first
// download of the model (about 90 MB) into the gitignored .cache/models.

export const EMBEDDING_MODEL = 'Xenova/all-MiniLM-L6-v2';
// The model reads at most 256 word pieces, the special tokens included (SPEC.md, finding F).
export const MAX_CHUNK_TOKENS = 256;
export const MODEL_CACHE_DIR = resolve(import.meta.dirname, '../../../../.cache/models');

const BATCH = 32;

export interface Embedder {
  // Word pieces the model reads for this text, [CLS] and [SEP] included.
  countTokens(text: string): number;
  embed(texts: readonly string[]): Promise<number[][]>;
}

// The model file itself, so an interrupted download does not count as cached.
export function modelCached(dir = MODEL_CACHE_DIR): boolean {
  return existsSync(join(dir, ...EMBEDDING_MODEL.split('/'), 'onnx', 'model.onnx'));
}

export async function localEmbedder(dir = MODEL_CACHE_DIR): Promise<Embedder> {
  const { AutoTokenizer, env, pipeline } = await import('@huggingface/transformers');
  env.cacheDir = dir;
  const tokenizer = await AutoTokenizer.from_pretrained(EMBEDDING_MODEL);
  // fp32 on the CPU, so the same text always gives the same vector.
  const extractor = await pipeline('feature-extraction', EMBEDDING_MODEL, { dtype: 'fp32' });
  return {
    countTokens: (text) => tokenizer.encode(text).length,
    async embed(texts) {
      const out: number[][] = [];
      for (let i = 0; i < texts.length; i += BATCH) {
        const batch = texts.slice(i, i + BATCH);
        const tensor = await extractor([...batch], { pooling: 'mean', normalize: true });
        const vectors = tensor.tolist() as number[][];
        for (const vector of vectors) {
          if (vector.length !== EMBEDDING_DIMENSIONS) {
            throw new Error(
              `embedding has ${vector.length} dimensions, not ${EMBEDDING_DIMENSIONS}`,
            );
          }
          out.push(vector);
        }
      }
      return out;
    },
  };
}

// One model per process, loaded on the first call. A failed load is not kept, so the next call
// tries again.
export function lazyLocalEmbedder(dir = MODEL_CACHE_DIR): () => Promise<Embedder> {
  let loading: Promise<Embedder> | undefined;
  return () =>
    (loading ??= localEmbedder(dir).catch((error: unknown) => {
      loading = undefined;
      throw error;
    }));
}
