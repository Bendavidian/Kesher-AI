import { describe, expect, it } from 'vitest';
import { PLANTED_CLAIMS } from '../research/planted';
import { plantedEval } from './verifier';

// The verifier part of the eval replays the T14 fixture from recordings/verifier/planted.json;
// planted.test.ts proves each claim, this proves the counts the report prints.
describe('plantedEval', () => {
  it('counts every planted error caught by its check and no clean claim removed', async () => {
    const result = await plantedEval();
    const planted = PLANTED_CLAIMS.filter((p) => p.expected !== 'supported').length;
    expect(result.claims).toBe(PLANTED_CLAIMS.length);
    // The claims plus the open question with advice language.
    expect(result.planted).toBe(planted + 1);
    expect(result.caught).toBe(planted + 1);
    expect(result.cleanRemoved).toEqual([]);
    expect(result.offExpectation).toEqual([]);
    expect(result.origins).toEqual({ model: PLANTED_CLAIMS.length, code: 0 });
    const verifier = result.byCheck.find((c) => c.check === 'verifier');
    expect(verifier).toEqual({ check: 'verifier', planted: 6, caught: 6 });
    expect(result.byCheck.find((c) => c.check === 'no_advice')).toEqual({
      check: 'no_advice',
      planted: 2,
      caught: 2,
    });
    expect(result.calls).toBe(1);
    expect(result.tokens).toBeGreaterThan(0);
  });
});
