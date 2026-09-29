import type { UniverseSymbol } from '@kesher/shared';
import { describe, expect, it } from 'vitest';
import type { CandidateSentence } from './candidates';
import type { Answer } from './classify';
import type { Role } from './edges';
import { buildRows, proposedKeys, type ResearchDecision } from './rows';

const ACCESSION = '0000804328-25-000085';

const candidate = (over: Partial<CandidateSentence>): CandidateSentence => ({
  id: 'aaaaaaaaaa',
  filer: 'QCOM',
  accession: ACCESSION,
  section: 'Item 1A',
  sentence: 'Examples include Broadcom and Nvidia.',
  previous: 'Such companies are generally competitors.',
  companies: ['NVDA', 'AVGO'],
  scope: 'section',
  borderline: null,
  ...over,
});

const answers = (id: string, roles: Partial<Record<UniverseSymbol, [Role, boolean]>>) =>
  new Map([
    [
      id,
      new Map(
        Object.entries(roles).map(([company, [role, usesPrevious]]) => [
          company as UniverseSymbol,
          { role, usesPrevious, provider: 'groq', model: 'openai/gpt-oss-120b' } satisfies Answer,
        ]),
      ),
    ],
  ]);

const build = (
  c: CandidateSentence,
  a: ReturnType<typeof answers>,
  research: Record<string, ResearchDecision> = {},
  verbatim: (text: string) => boolean = () => true,
) =>
  buildRows({
    candidates: [c],
    answers: a,
    research,
    peers: new Set(['NVDA|QCOM']),
    isVerbatim: (_, text) => verbatim(text),
  });

describe('buildRows', () => {
  it('makes one row per named company with the model proposal and the Finnhub flag', () => {
    const c = candidate({});
    const rows = build(c, answers(c.id, { NVDA: ['competitor', false], AVGO: ['none', false] }));
    expect(rows.map((r) => [r.id, r.finnhubPeer, r.proposals])).toEqual([
      [
        'aaaaaaaaaa:NVDA',
        true,
        [
          {
            key: 'competitor:NVDA|QCOM',
            edge: { from: 'NVDA', type: 'competitor_of', to: 'QCOM' },
            by: ['model'],
            seeded: false,
          },
        ],
      ],
      ['aaaaaaaaaa:AVGO', false, []],
    ]);
  });

  it('merges a research proposal for the same relationship and keeps its decision', () => {
    const c = candidate({});
    const research = {
      [c.id]: {
        decision: 'accept',
        edges: [
          { from: 'AVGO', type: 'competitor_of', to: 'QCOM', pick: true },
          { from: 'NVDA', type: 'competitor_of', to: 'QCOM', pick: true },
        ],
      },
    } satisfies Record<string, ResearchDecision>;
    const [nvda, avgo] = build(
      c,
      answers(c.id, { NVDA: ['competitor', true], AVGO: ['none', false] }),
      research,
    );
    expect(nvda?.proposals[0]?.by).toEqual(['model', 'research']);
    expect(nvda?.research?.edges).toEqual([
      { from: 'NVDA', type: 'competitor_of', to: 'QCOM', pick: true },
    ]);
    // The model said none for Broadcom; research still puts the pair up for review.
    expect(avgo?.proposals.map((p) => p.by)).toEqual([['research']]);
  });

  it('keeps the sentence as the quote and offers the two sentence span only when verbatim', () => {
    const c = candidate({});
    const [row] = build(c, answers(c.id, { NVDA: ['competitor', true] }));
    expect(row?.quote).toBe('Examples include Broadcom and Nvidia.');
    expect(row?.longQuote).toBe(
      'Such companies are generally competitors. Examples include Broadcom and Nvidia.',
    );
    const [notVerbatim] = build(c, answers(c.id, { NVDA: ['competitor', true] }), {}, (text) =>
      text.startsWith('Examples'),
    );
    expect(notVerbatim?.longQuote).toBeNull();
    const [none] = build(c, answers(c.id, { NVDA: ['none', true] }));
    expect(none?.longQuote).toBeNull();
  });

  it('uses the research span as the quote when it is verbatim', () => {
    const c = candidate({});
    const span = 'Such companies are generally competitors. Examples include Broadcom and Nvidia.';
    const research = {
      [c.id]: {
        decision: 'accept',
        edges: [{ from: 'NVDA', type: 'competitor_of', to: 'QCOM', pick: true }],
        quote: span,
      },
    } satisfies Record<string, ResearchDecision>;
    const [row] = build(c, answers(c.id, { NVDA: ['competitor', true] }), research);
    expect(row?.quote).toBe(span);
    expect(row?.longQuote).toBeNull();
  });

  it('leaves a row unanswered when the model skipped the pair', () => {
    const c = candidate({});
    const rows = build(c, new Map());
    expect(rows.map((r) => [r.model, r.proposals])).toEqual([
      [null, []],
      [null, []],
    ]);
  });

  it('marks a proposal the seed already owns', () => {
    const c = candidate({
      filer: 'NVDA',
      companies: ['TSM'],
      sentence: 'We utilize foundries, such as TSMC.',
    });
    const [row] = build(c, answers(c.id, { TSM: ['supplies_filer', false] }));
    expect(row?.proposals[0]).toMatchObject({ key: 'supply:TSM>NVDA', seeded: true });
    expect(proposedKeys(build(c, answers(c.id, { TSM: ['supplies_filer', false] })))).toEqual(
      new Set(),
    );
  });

  it('puts an extra sentence up as borderline even when the model says none', () => {
    const c = candidate({
      filer: 'ASML',
      companies: ['TSM'],
      scope: 'extra',
      previous: null,
      sentence: 'We received the TSMC Supplier award.',
      borderline: { edge: { from: 'ASML', type: 'supplier_of', to: 'TSM' }, note: 'Award name.' },
    });
    const [row] = build(c, answers(c.id, { TSM: ['none', false] }));
    expect(row?.borderline).toBe('Award name.');
    expect(row?.proposals).toEqual([
      {
        key: 'supply:ASML>TSM',
        edge: { from: 'ASML', type: 'supplier_of', to: 'TSM' },
        by: ['borderline'],
        seeded: false,
      },
    ]);
  });
});
