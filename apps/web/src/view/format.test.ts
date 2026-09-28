import { describe, expect, it } from 'vitest';
import {
  direction,
  formatDay,
  formatEt,
  formatPercent,
  formatScore,
  joinList,
  MINUS,
} from './format';

describe('formatPercent', () => {
  it('carries a plus sign on gains', () => {
    expect(formatPercent(1.25)).toBe('+1.25%');
    expect(formatPercent(0.1)).toBe('+0.10%');
  });

  it('uses a true minus, not a hyphen, on losses', () => {
    expect(MINUS).toBe('−');
    expect(formatPercent(-1.16)).toBe('−1.16%');
    expect(formatPercent(-0.54)).not.toContain('-');
  });

  it('shows zero without a sign', () => {
    expect(formatPercent(0)).toBe('0.00%');
    expect(formatPercent(-0)).toBe('0.00%');
    expect(formatPercent(-0.001)).toBe('0.00%');
  });
});

describe('direction', () => {
  it('maps the sign of the rounded value to up, down or flat', () => {
    expect(direction(1.31)).toBe('up');
    expect(direction(-0.07)).toBe('down');
    expect(direction(0)).toBe('flat');
    expect(direction(0.004)).toBe('flat');
  });
});

describe('formatScore', () => {
  it('always shows two decimals', () => {
    expect(formatScore(0.8)).toBe('0.80');
    expect(formatScore(1)).toBe('1.00');
    expect(formatScore(0)).toBe('0.00');
  });
});

describe('formatEt', () => {
  it('shows the time in New York time on a 24 hour clock', () => {
    expect(formatEt(new Date('2024-04-03T03:57:09Z'))).toBe('Apr 2, 2024, 23:57 ET');
    expect(formatEt(new Date('2024-04-02T19:59:00Z'))).toBe('Apr 2, 2024, 15:59 ET');
  });
});

describe('formatDay', () => {
  it('formats an ISO date without shifting it by time zone', () => {
    expect(formatDay('2026-02-25')).toBe('Feb 25, 2026');
  });
});

describe('joinList', () => {
  it('joins with commas and a final conjunction', () => {
    expect(joinList(['NVDA'])).toBe('NVDA');
    expect(joinList(['KO', 'JNJ'])).toBe('KO and JNJ');
    expect(joinList(['AMD', 'AVGO', 'TSM', 'ASML'])).toBe('AMD, AVGO, TSM and ASML');
    expect(joinList(['KO', 'JNJ', 'XOM'], 'or')).toBe('KO, JNJ or XOM');
  });
});
