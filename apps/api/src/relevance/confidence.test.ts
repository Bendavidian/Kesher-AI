import type { Tier } from '@kesher/shared';
import { describe, expect, it } from 'vitest';
import { confidenceFor } from './confidence';

const source = (tier: Tier, publisher: string | null = null) => ({ tier, publisher });

describe('confidenceFor, the SPEC.md confidence rule', () => {
  it('is high with a Tier 1 source', () => {
    expect(confidenceFor([source(1)])).toBe('high');
    expect(confidenceFor([source(3), source(1)])).toBe('high');
  });

  it('is high with two independent Tier 2 sources', () => {
    expect(confidenceFor([source(2, 'Benzinga'), source(2, 'Reuters')])).toBe('high');
  });

  it('counts one publisher once, so two items from one wire stay medium', () => {
    expect(confidenceFor([source(2, 'Benzinga'), source(2, 'Benzinga')])).toBe('medium');
    expect(confidenceFor([source(2), source(2)])).toBe('medium');
  });

  it('is medium with a single Tier 2 source', () => {
    expect(confidenceFor([source(2, 'Benzinga')])).toBe('medium');
    expect(confidenceFor([source(2, 'Benzinga'), source(3), source(3)])).toBe('medium');
  });

  it('is low with Tier 3 sources only, or none', () => {
    expect(confidenceFor([source(3), source(3)])).toBe('low');
    expect(confidenceFor([])).toBe('low');
  });
});
