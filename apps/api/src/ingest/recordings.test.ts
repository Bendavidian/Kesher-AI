import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO_SOURCE_ID } from '../seed/config';
import { loadRecording, recordingPath } from './recordings';

describe('recordings', () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'kesher-recordings-'));
    await mkdir(join(dir, 'alpaca'));
    await writeFile(join(dir, 'alpaca', '111.json'), JSON.stringify({ provider: 'alpaca' }));
    const demo = await loadRecording(DEMO_SOURCE_ID);
    await writeFile(join(dir, 'alpaca', '222.json'), JSON.stringify(demo));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('holds the pinned demo item, recorded by id', async () => {
    const recording = await loadRecording(DEMO_SOURCE_ID);
    expect(recording?.item.id).toBe(Number(DEMO_SOURCE_ID));
    expect(recording?.item.headline).toBe(
      'TSMC Suspends Chip Production After Taiwan Rocked By Strongest Tremor In 25 Years',
    );
    expect(recording?.item.symbols).toContain('TSM');
    expect(recording?.item.created_at).toBe('2024-04-03T03:57:09Z');
    expect(recording?.item).not.toHaveProperty('content');
  });

  it('rejects ids that are not Alpaca news ids', () => {
    for (const id of ['../x', 'abc', '', '1'.repeat(21), '38062166.json']) {
      expect(() => recordingPath(id, dir), id).toThrow();
    }
  });

  it('returns null for an id with no recording', async () => {
    expect(await loadRecording('999', dir)).toBeNull();
  });

  it('throws on a recording that fails its schema', async () => {
    await expect(loadRecording('111', dir)).rejects.toThrow();
  });

  it('throws on a recording filed under another id', async () => {
    await expect(loadRecording('222', dir)).rejects.toThrow(/holds item 38062166/);
  });
});
