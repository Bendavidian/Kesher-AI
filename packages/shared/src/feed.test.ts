import { describe, expect, it } from 'vitest';
import { relevanceBand } from './feed';

describe('relevanceBand', () => {
  it('is none at 0, medium above 0 and high from 0.8', () => {
    expect(relevanceBand(0)).toBe('none');
    expect(relevanceBand(0.001)).toBe('medium');
    expect(relevanceBand(0.448)).toBe('medium');
    expect(relevanceBand(0.79)).toBe('medium');
    expect(relevanceBand(0.8)).toBe('high');
    expect(relevanceBand(1)).toBe('high');
  });
});
