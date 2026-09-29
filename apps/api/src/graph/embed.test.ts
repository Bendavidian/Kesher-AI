import { beforeAll, describe, expect, it } from 'vitest';
import { chunkSentences } from './chunks';
import { localEmbedder, MAX_CHUNK_TOKENS, modelCached, type Embedder } from './embed';

// Runs the real local model when it is in .cache/models (npm run graph:chunks downloads it once);
// otherwise it skips, so CI never downloads the model.
const cached = modelCached();
if (!cached)
  console.warn('embed.test.ts skipped: run npm run graph:chunks once to cache the model.');

const dot = (a: number[], b: number[]) => a.reduce((sum, x, i) => sum + x * (b[i] ?? 0), 0);

describe.runIf(cached)('localEmbedder with Xenova/all-MiniLM-L6-v2', () => {
  let embedder: Embedder;

  beforeAll(async () => {
    embedder = await localEmbedder();
  }, 120_000);

  it('counts word pieces with [CLS] and [SEP]', () => {
    expect(embedder.countTokens('')).toBe(2);
    expect(embedder.countTokens('foundry dependency')).toBe(4);
  });

  it('gives normalized 384 dimension vectors, the same for the same text', async () => {
    const [a, b] = await embedder.embed(['foundry dependency', 'foundry dependency']);
    expect(a).toHaveLength(384);
    expect(dot(a!, a!)).toBeCloseTo(1, 5);
    expect(b).toEqual(a);
  });

  it('keeps real filing text within the model limit after chunking', () => {
    const long = 'Taiwan Semiconductor Manufacturing Company manufactures our wafers. '.repeat(60);
    const chunks = chunkSentences(long.trim().split(/(?<=\.) /), (t) => embedder.countTokens(t));
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks)
      expect(embedder.countTokens(chunk)).toBeLessThanOrEqual(MAX_CHUNK_TOKENS);
  });

  it('ranks the NVIDIA foundry passage first for "foundry dependency", as in the spike', async () => {
    const docs = [
      'We utilize foundries, such as Taiwan Semiconductor Manufacturing Company Limited, or TSMC, and Samsung Electronics Co., Ltd., or Samsung, to produce our semiconductor wafers.',
      'Our beverage products are sold through bottling partners in more than 200 countries.',
      'Crude oil prices affect the results of our upstream segment.',
      'Our pharmaceutical segment depends on regulatory approvals for new medicines.',
    ];
    const [query, ...vectors] = await embedder.embed(['foundry dependency', ...docs]);
    const scores = vectors.map((v) => dot(query!, v));
    expect(scores.indexOf(Math.max(...scores))).toBe(0);
  });
});
