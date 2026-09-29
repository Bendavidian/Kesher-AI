import { describe, expect, it } from 'vitest';
import { MAX_TOOL_OUTPUT_BYTES, fitItems, outputBytes } from './fit';

describe('fitItems', () => {
  const build = (kept: string[], omitted: number) => ({ items: kept, omitted });

  it('keeps everything that fits', () => {
    expect(fitItems(['a', 'b'], build)).toEqual({ items: ['a', 'b'], omitted: 0 });
  });

  it('drops whole items from the end until the output fits, never cutting one', () => {
    const items = Array.from({ length: 5 }, (_, i) => `${i}${'é'.repeat(1_000)}`);
    const output = fitItems(items, build);
    expect(outputBytes(output)).toBeLessThanOrEqual(MAX_TOOL_OUTPUT_BYTES);
    expect(output.items).toEqual(items.slice(0, 4));
    expect(output.omitted).toBe(1);
  });

  it('answers no items when even one is too large', () => {
    expect(fitItems(['x'.repeat(10_000)], build)).toEqual({ items: [], omitted: 1 });
  });
});
