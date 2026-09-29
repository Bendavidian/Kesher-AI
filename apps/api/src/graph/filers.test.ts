import { describe, expect, it } from 'vitest';
import { COMPANIES } from '../seed/config';
import { FILERS, mentions } from './filers';

describe('FILERS', () => {
  it('covers the universe with the seeded CIKs and forms', () => {
    expect(FILERS.map((f) => f.symbol)).toEqual(COMPANIES.map((c) => c.symbol));
    for (const filer of FILERS) {
      const company = COMPANIES.find((c) => c.symbol === filer.symbol);
      expect(filer.ciks[0]).toBe(company?.cik);
      expect(filer.form).toBe(company?.filerType);
    }
    expect(FILERS.filter((f) => f.form === '10-K')).toHaveLength(15);
  });

  it('tries the old XOM CIK after the seeded one', () => {
    expect(FILERS.find((f) => f.symbol === 'XOM')?.ciks).toEqual(['0002115436', '0000034088']);
  });
});

describe('mentions', () => {
  it('finds each company once, by any alias, on word boundaries', () => {
    expect(
      mentions(
        'We buy from Taiwan Semiconductor Manufacturing Company (TSMC) and compete with AMD.',
      ),
    ).toEqual([
      { symbol: 'AMD', alias: 'AMD' },
      { symbol: 'TSM', alias: 'Taiwan Semiconductor Manufacturing' },
    ]);
    expect(mentions('AMDOCS and Intelligent systems')).toEqual([]);
  });

  it('prefers the longest alias', () => {
    expect(mentions('Meta Platforms, Inc.')).toEqual([{ symbol: 'META', alias: 'Meta Platforms' }]);
  });

  it('ignores names that only contain an alias', () => {
    expect(mentions('Coca-Cola FEMSA bottles our drinks.')).toEqual([]);
    expect(mentions('Coca-Cola FEMSA and Coca-Cola')).toEqual([
      { symbol: 'KO', alias: 'Coca-Cola' },
    ]);
  });
});
