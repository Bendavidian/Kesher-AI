import { randomUUID } from 'node:crypto';
import { EMBEDDING_DIMENSIONS, FilingChunk } from '@kesher/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { collection } from '../db/collections';
import { ensureCollections, ensureIndexes } from '../db/indexes';
import { MONGO_START_TIMEOUT_MS, startTestMongo, type TestMongo } from '../test/mongo';
import { writeChunks, type SectionChunk } from './chunks';

const vector = (seed: number) =>
  Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) =>
    i === seed % EMBEDDING_DIMENSIONS ? 1 : 0,
  );

const chunks = (n: number, suffix = ''): SectionChunk[] =>
  Array.from({ length: n }, (_, i) => ({
    section: i < 2 ? 'Item 1' : 'Item 1A',
    heading: null,
    text: `Chunk ${i}${suffix}.`,
    embedText: `Chunk ${i}${suffix}.`,
  }));

describe('writeChunks on mongod', () => {
  let mongo: TestMongo;
  const nvda = { sourceId: randomUUID(), symbol: 'NVDA' as const };
  const amd = { sourceId: randomUUID(), symbol: 'AMD' as const };
  const stored = async (sourceId: string) =>
    (
      await collection(mongo.db, 'filing_chunks')
        .find({ sourceId })
        .sort({ chunkIndex: 1 })
        .toArray()
    ).map((c) => FilingChunk.parse(c));

  beforeAll(async () => {
    mongo = await startTestMongo('kesher_chunks_test');
    await ensureCollections(mongo.db);
    await ensureIndexes(mongo.db);
  }, MONGO_START_TIMEOUT_MS);

  afterAll(async () => {
    await mongo?.stop();
  });

  it('writes one valid chunk per text with its section and vector', async () => {
    const counts = await writeChunks(mongo.db, nvda, chunks(4), [0, 1, 2, 3].map(vector));
    expect(counts).toEqual({ inserted: 4, updated: 0, unchanged: 0, deleted: 0 });
    await writeChunks(mongo.db, amd, chunks(2), [0, 1].map(vector));
    const rows = await stored(nvda.sourceId);
    expect(rows.map((r) => [r.chunkIndex, r.section, r.text, r.form, r.symbol])).toEqual([
      [0, 'Item 1', 'Chunk 0.', '10-K', 'NVDA'],
      [1, 'Item 1', 'Chunk 1.', '10-K', 'NVDA'],
      [2, 'Item 1A', 'Chunk 2.', '10-K', 'NVDA'],
      [3, 'Item 1A', 'Chunk 3.', '10-K', 'NVDA'],
    ]);
    expect(rows[2]?.embedding).toEqual(vector(2));
  });

  it('changes nothing when the same chunks are written again', async () => {
    const before = await stored(nvda.sourceId);
    const counts = await writeChunks(mongo.db, nvda, chunks(4), [0, 1, 2, 3].map(vector));
    expect(counts).toEqual({ inserted: 0, updated: 0, unchanged: 4, deleted: 0 });
    expect(await stored(nvda.sourceId)).toEqual(before);
  });

  it('updates changed chunks, removes the tail, and leaves other filings alone', async () => {
    const amdBefore = await stored(amd.sourceId);
    const counts = await writeChunks(mongo.db, nvda, chunks(3, ' again'), [5, 6, 7].map(vector));
    expect(counts).toEqual({ inserted: 0, updated: 3, unchanged: 0, deleted: 1 });
    expect((await stored(nvda.sourceId)).map((r) => r.text)).toEqual([
      'Chunk 0 again.',
      'Chunk 1 again.',
      'Chunk 2 again.',
    ]);
    expect(await stored(amd.sourceId)).toEqual(amdBefore);
  });

  it('refuses a filing with no chunks instead of deleting its chunks', async () => {
    const before = await stored(amd.sourceId);
    await expect(writeChunks(mongo.db, amd, [], [])).rejects.toThrow('no chunks for Source');
    expect(await stored(amd.sourceId)).toEqual(before);
  });

  it('refuses chunks without one embedding each', async () => {
    await expect(writeChunks(mongo.db, nvda, chunks(2), [vector(0)])).rejects.toThrow(
      'one embedding per chunk',
    );
  });
});
