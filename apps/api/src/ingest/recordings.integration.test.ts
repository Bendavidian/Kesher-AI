import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LiveRecording } from '@kesher/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { collection } from '../db/collections';
import { ensureCollections, ensureIndexes } from '../db/indexes';
import { DEMO_SOURCE_ID } from '../seed/config';
import { MONGO_START_TIMEOUT_MS, startTestMongo, type TestMongo } from '../test/mongo';
import { exportRecording, findRecording, loadRecording, recordLive } from './recordings';

describe('live recordings on mongod', () => {
  let mongo: TestMongo;
  let dir: string;
  const at = new Date('2026-09-29T12:00:00Z');

  beforeAll(async () => {
    mongo = await startTestMongo('kesher_recordings_test');
    await ensureCollections(mongo.db);
    await ensureIndexes(mongo.db);
    dir = await mkdtemp(join(tmpdir(), 'kesher-live-recordings-'));
  }, MONGO_START_TIMEOUT_MS);

  beforeEach(async () => {
    await collection(mongo.db, 'recordings').deleteMany({});
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
    await mongo?.stop();
  });

  const demoItem = async () => (await loadRecording(DEMO_SOURCE_ID))!.item;

  it('stores the item once, without the article body or the images, and keeps the first', async () => {
    const item = await demoItem();
    const raw = { ...item, content: '<p>The full article.</p>', images: [{ url: 'x' }] };
    // The live stream hands over parsed items; recordLive parses again, so extra keys never land.
    expect(await recordLive(mongo.db, { provider: 'alpaca', item: raw }, at)).toBe(true);
    const later = { ...item, headline: 'An updated headline' };
    expect(await recordLive(mongo.db, { provider: 'alpaca', item: later })).toBe(false);

    const stored = await collection(mongo.db, 'recordings').find({}).toArray();
    expect(stored).toHaveLength(1);
    const recording = LiveRecording.parse(stored[0]);
    expect(recording).toMatchObject({
      provider: 'alpaca',
      externalId: DEMO_SOURCE_ID,
      recordedAt: at,
    });
    expect(recording.item).toEqual(item);
    expect(stored[0]!.item).not.toHaveProperty('content');
    expect(stored[0]!.item).not.toHaveProperty('images');
  });

  it('finds a recording in the committed file first, then in the collection', async () => {
    const item = await demoItem();
    await recordLive(mongo.db, { provider: 'alpaca', item: { ...item, id: 99000002 } });
    // The demo file wins over a collection copy with a changed headline.
    await recordLive(mongo.db, { provider: 'alpaca', item: { ...item, headline: 'Changed' } });

    const fromFile = await findRecording(mongo.db, 'alpaca', DEMO_SOURCE_ID);
    expect(fromFile).toEqual({ provider: 'alpaca', item });
    const fromCollection = await findRecording(mongo.db, 'alpaca', '99000002');
    expect(fromCollection).toEqual({ provider: 'alpaca', item: { ...item, id: 99000002 } });
    expect(await findRecording(mongo.db, 'alpaca', '99000003')).toBeNull();
  });

  it('reads EDGAR recordings from recordings/sec_edgar/<accession>.json', async () => {
    const filing = {
      cik: '0001045810',
      accessionNumber: '0001045810-26-000080',
      form: '8-K',
      filingDate: '2026-09-29',
      acceptanceDateTime: '2026-09-29T12:03:56.000Z',
      primaryDocument: 'nvda-8k.htm',
      items: '2.02',
    };
    await mkdir(join(dir, 'sec_edgar'), { recursive: true });
    await writeFile(
      join(dir, 'sec_edgar', `${filing.accessionNumber}.json`),
      JSON.stringify({ provider: 'sec_edgar', recordedAt: at.toISOString(), item: filing }),
    );
    expect(await findRecording(mongo.db, 'sec_edgar', filing.accessionNumber, dir)).toEqual({
      provider: 'sec_edgar',
      item: filing,
    });
    await writeFile(
      join(dir, 'sec_edgar', '0001045810-26-000081.json'),
      JSON.stringify({ provider: 'sec_edgar', recordedAt: at.toISOString(), item: filing }),
    );
    await expect(findRecording(mongo.db, 'sec_edgar', '0001045810-26-000081', dir)).rejects.toThrow(
      /holds filing 0001045810-26-000080/,
    );
  });

  it('exports a live recording to a file that replay loads, and keeps an existing file', async () => {
    const item = { ...(await demoItem()), id: 99000004 };
    await recordLive(mongo.db, { provider: 'alpaca', item }, at);

    const written = await exportRecording(mongo.db, 'alpaca', '99000004', { dir });
    expect(written).toEqual({ outcome: 'written', path: join(dir, 'alpaca', '99000004.json') });
    expect(await loadRecording('99000004', dir)).toEqual({
      provider: 'alpaca',
      recordedAt: at.toISOString(),
      item,
    });
    expect(await exportRecording(mongo.db, 'alpaca', '99000004', { dir })).toMatchObject({
      outcome: 'exists',
    });
    expect(
      await exportRecording(mongo.db, 'alpaca', '99000004', { dir, force: true }),
    ).toMatchObject({ outcome: 'written' });
    expect(await exportRecording(mongo.db, 'alpaca', '99000005', { dir })).toEqual({
      outcome: 'missing',
    });
  });
});
