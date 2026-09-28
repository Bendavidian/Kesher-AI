import { describe, expect, it } from 'vitest';
import { EMBEDDING_DIMENSIONS, Embedding, Importance, THEMES, Ticker } from './common';
import { BENCHMARKS, UNIVERSE, UniverseSymbol } from './universe';

describe('demo universe', () => {
  it('holds the 17 companies from SPEC.md', () => {
    expect(UNIVERSE).toHaveLength(17);
    expect(new Set(UNIVERSE).size).toBe(17);
  });

  it('keeps the benchmarks out of the universe', () => {
    for (const benchmark of BENCHMARKS) {
      expect(UniverseSymbol.safeParse(benchmark).success).toBe(false);
    }
  });
});

describe('themes', () => {
  it('match the 20 themes of the SPEC.md taxonomy', () => {
    expect(THEMES).toHaveLength(20);
    expect(new Set(THEMES).size).toBe(20);
  });
});

describe('Embedding', () => {
  it(`accepts exactly ${EMBEDDING_DIMENSIONS} numbers`, () => {
    expect(EMBEDDING_DIMENSIONS).toBe(384);
    expect(Embedding.safeParse(new Array<number>(384).fill(0.1)).success).toBe(true);
  });

  it('rejects any other length', () => {
    expect(Embedding.safeParse(new Array<number>(383).fill(0.1)).success).toBe(false);
    expect(Embedding.safeParse(new Array<number>(385).fill(0.1)).success).toBe(false);
  });
});

describe('Importance', () => {
  it('is an integer from 1 to 5', () => {
    expect(Importance.safeParse(1).success).toBe(true);
    expect(Importance.safeParse(5).success).toBe(true);
    expect(Importance.safeParse(0).success).toBe(false);
    expect(Importance.safeParse(6).success).toBe(false);
    expect(Importance.safeParse(3.5).success).toBe(false);
  });
});

describe('Ticker', () => {
  it('accepts US tickers and home listings', () => {
    expect(Ticker.safeParse('NVDA').success).toBe(true);
    expect(Ticker.safeParse('2330.TW').success).toBe(true);
  });

  it('rejects lower case and empty values', () => {
    expect(Ticker.safeParse('nvda').success).toBe(false);
    expect(Ticker.safeParse('').success).toBe(false);
  });
});
