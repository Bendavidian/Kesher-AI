import { describe, expect, it } from 'vitest';
import { candidateId, collectCandidates, type ExtraSentence } from './candidates';
import { FILERS, type Filer } from './filers';

const filer = (symbol: string): Filer => {
  const found = FILERS.find((f) => f.symbol === symbol);
  if (!found) throw new Error(symbol);
  return found;
};

const tenK = (item1: string[], item1a: string[]) =>
  [
    'Item 1. Business',
    ...item1,
    'Item 1A. Risk Factors',
    ...item1a,
    'Item 1B. Unresolved Staff Comments',
  ]
    .map((p) => `<p>${p}</p>`)
    .join('');

describe('candidateId', () => {
  it('matches the id docs/research/edge-candidates.md uses for the NVIDIA foundry sentence', () => {
    const sentence =
      'We utilize foundries, such as Taiwan Semiconductor Manufacturing Company Limited, or TSMC, and Samsung Electronics Co., Ltd., or Samsung, to produce our semiconductor wafers.';
    expect(candidateId('0001045810-26-000021', sentence)).toBe('eef07e7249');
  });
});

describe('collectCandidates', () => {
  const nvda = filer('NVDA');
  const filing = { accession: '0001045810-26-000021' };

  it('keeps sentences that name another universe company, with section and previous sentence', () => {
    const html = tenK(
      ['NVIDIA designs GPUs.', 'Our competitors include AMD and Intel.'],
      ['We rely on TSMC.'],
    );
    const { candidates, notVerbatim } = collectCandidates(nvda, filing, html, []);
    expect(notVerbatim).toBe(0);
    expect(candidates).toEqual([
      {
        id: candidateId(filing.accession, 'Our competitors include AMD and Intel.'),
        filer: 'NVDA',
        accession: filing.accession,
        section: 'Item 1',
        sentence: 'Our competitors include AMD and Intel.',
        previous: 'NVIDIA designs GPUs.',
        companies: ['AMD', 'INTC'],
        scope: 'section',
        borderline: null,
      },
      expect.objectContaining({
        section: 'Item 1A',
        sentence: 'We rely on TSMC.',
        previous: null,
        companies: ['TSM'],
      }),
    ]);
  });

  it('keeps a repeated sentence once', () => {
    const html = tenK(['We rely on TSMC.'], ['We rely on TSMC.']);
    expect(collectCandidates(nvda, filing, html, []).candidates).toHaveLength(1);
  });

  it('adds an extra sentence from outside the sections as a borderline candidate', () => {
    const extra: ExtraSentence = {
      symbol: 'NVDA',
      section: 'Appendix (page 9)',
      startsWith: 'We won the TSMC',
      edge: { from: 'NVDA', type: 'customer_of', to: 'TSM' },
      note: 'Role only in the award name.',
    };
    const html = `${tenK(['NVIDIA designs GPUs.'], ['Risk.'])}<p>We won the TSMC award.</p>`;
    expect(collectCandidates(nvda, filing, html, [extra]).candidates).toEqual([
      expect.objectContaining({
        section: 'Appendix (page 9)',
        sentence: 'We won the TSMC award.',
        companies: ['TSM'],
        scope: 'extra',
        borderline: { edge: extra.edge, note: extra.note },
      }),
    ]);
  });

  it('fails when an extra sentence is not found exactly once', () => {
    const extra: ExtraSentence = {
      symbol: 'NVDA',
      section: 'x',
      startsWith: 'Missing sentence',
      edge: { from: 'NVDA', type: 'customer_of', to: 'TSM' },
      note: 'x',
    };
    expect(() => collectCandidates(nvda, filing, tenK(['A.'], ['B.']), [extra])).toThrow(
      'found 0 times',
    );
  });
});
