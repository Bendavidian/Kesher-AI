import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadEvents, loadPoisoned, SyntheticId, type EvalEvent } from '../eval/dataset';
import { libraryOrder } from './library';

const CANDIDATES = resolve(import.meta.dirname, '../../../../docs/research/eval-candidates.md');

describe('the event library', () => {
  it('is the 30 real items of docs/research/eval-candidates.md and no poisoned item', async () => {
    const table = await readFile(CANDIDATES, 'utf8');
    // Rows of the candidates table: | # | Source id | ...
    const listed = [...table.matchAll(/^\| \d+ \| (\d+) \|/gm)].map((match) => match[1]);
    const events = await loadEvents();

    expect(listed).toHaveLength(30);
    expect(events.map((event) => event.id).sort()).toEqual([...listed].sort());
    expect(events.some((event) => SyntheticId.safeParse(event.id).success)).toBe(false);
    const poisoned = new Set((await loadPoisoned()).map((item) => item.id));
    expect(events.filter((event) => poisoned.has(event.id))).toEqual([]);
  });

  it('loads oldest first, whatever the order of the file', () => {
    const event = (id: string, createdAt: string): EvalEvent => ({
      id,
      symbol: 'TSM',
      createdAt,
      updatedAt: createdAt,
      type: 'earnings',
    });
    const ordered = libraryOrder([
      event('3', '2025-01-16T05:56:57Z'),
      event('1', '2024-04-03T03:57:09Z'),
      event('2', '2024-08-01T20:01:54Z'),
      event('0', '2024-08-01T20:01:54Z'),
    ]);
    expect(ordered.map((e) => e.id)).toEqual(['1', '0', '2', '3']);
  });
});
