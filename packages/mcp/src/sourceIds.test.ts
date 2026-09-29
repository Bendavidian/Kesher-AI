import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { nameUuid, sourceIdFor } from './sourceIds';
import type { ToolDeps } from './tools';

describe('nameUuid', () => {
  it('gives the same valid version 5 UUID for the same name, and another for another name', () => {
    const id = nameUuid(
      'alpaca:price_reaction:TSM,SMH,SPY:previous_close:2024-04-02T20:00:00.000Z',
    );
    expect(z.uuid().safeParse(id).success).toBe(true);
    expect(id[14]).toBe('5');
    expect(
      nameUuid('alpaca:price_reaction:TSM,SMH,SPY:previous_close:2024-04-02T20:00:00.000Z'),
    ).toBe(id);
    expect(nameUuid('sec_edgar:0001045810-26-000021')).not.toBe(id);
  });
});

describe('sourceIdFor', () => {
  const sources = (found: object | null) =>
    ({ findOne: () => Promise.resolve(found) }) as unknown as ToolDeps['sources'];

  it('prefers the id of a stored Source with that provider id', async () => {
    const stored = randomUUID();
    expect(await sourceIdFor(sources({ _id: stored }), 'sec_edgar', 'x')).toBe(stored);
  });

  it('otherwise names the id the Source will be stored under', async () => {
    expect(await sourceIdFor(sources(null), 'sec_edgar', 'x')).toBe(nameUuid('sec_edgar:x'));
  });
});
