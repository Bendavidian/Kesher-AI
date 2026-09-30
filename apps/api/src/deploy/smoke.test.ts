import { describe, expect, it } from 'vitest';
import { formatResult, passed, type CheckResult } from './smoke';

const result = (status: CheckResult['status']): CheckResult => ({
  name: 'health',
  status,
  detail: 'ok',
  ms: 1234,
});

describe('passed', () => {
  it('needs at least one check and no failure; a skip does not fail the run', () => {
    expect(passed([])).toBe(false);
    expect(passed([result('pass'), result('skip')])).toBe(true);
    expect(passed([result('pass'), result('fail')])).toBe(false);
  });
});

describe('formatResult', () => {
  it('prints the mark, the name, the seconds and the detail on one line', () => {
    expect(formatResult(result('fail'))).toBe('FAIL  health                  1.2 s  ok');
  });
});
