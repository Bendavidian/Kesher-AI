import { describe, expect, it } from 'vitest';
import { selectFacts, type ConceptFacts, type XbrlFact } from './facts';

const fact = (
  end: string,
  frame: string | null,
  val = 1,
  start: string | null = null,
): XbrlFact => ({
  start,
  end,
  val,
  accn: '0001045810-26-000021',
  fy: 2026,
  fp: 'FY',
  form: '10-K',
  filed: '2026-02-25',
  frame,
});

const concept = (name: string, units: Record<string, XbrlFact[]>): ConceptFacts => ({
  cik: '0001045810',
  concept: name,
  units,
});

describe('selectFacts', () => {
  it('keeps the 3 newest fiscal years and 4 newest quarters, framed values only', () => {
    const years = ['CY2021', 'CY2022', 'CY2023', 'CY2024'].map((frame, i) =>
      fact(`${2022 + i}-01-29`, frame, i),
    );
    const quarters = ['CY2024Q1', 'CY2024Q2', 'CY2024Q3', 'CY2024Q4', 'CY2025Q1'].map((frame, i) =>
      fact(`2025-0${i + 1}-28`, frame, 10 + i),
    );
    const repeated = fact('2025-01-29', null, 99);
    const selected = selectFacts([concept('Revenues', { USD: [...years, ...quarters, repeated] })]);
    expect(selected?.annual.map((f) => f.frame)).toEqual(['CY2024', 'CY2023', 'CY2022']);
    expect(selected?.quarterly.map((f) => f.frame)).toEqual([
      'CY2025Q1',
      'CY2024Q4',
      'CY2024Q3',
      'CY2024Q2',
    ]);
    expect(selected?.annual.map((f) => f.val)).not.toContain(99);
  });

  it('takes the concept with the newest period, since filers switch concepts', () => {
    const old = concept('RevenueFromContractWithCustomerExcludingAssessedTax', {
      USD: [fact('2022-01-30', 'CY2021')],
    });
    const current = concept('Revenues', { USD: [fact('2026-01-25', 'CY2025')] });
    expect(selectFacts([old, current])?.concept).toBe('Revenues');
    expect(selectFacts([current, old])?.concept).toBe('Revenues');
  });

  it('counts balances on a date as quarters, and keeps their unit', () => {
    const selected = selectFacts([
      concept('EarningsPerShareDiluted', { 'USD/shares': [fact('2026-04-26', 'CY2026Q1I', 3.1)] }),
    ]);
    expect(selected).toMatchObject({ unit: 'USD/shares', annual: [] });
    expect(selected?.quarterly.map((f) => f.val)).toEqual([3.1]);
  });

  it('answers null when nothing carries a calendar frame', () => {
    expect(selectFacts([])).toBeNull();
    expect(selectFacts([concept('Revenues', { USD: [fact('2026-01-25', null)] })])).toBeNull();
  });
});
