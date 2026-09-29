import { describe, expect, it } from 'vitest';
import {
  groupRelationships,
  loadCandidates,
  parseInput,
  pending,
  record,
  renderGroup,
  Review,
  staleReviews,
} from './review';
import { proposedKeys, type CandidatesFile, type Row } from './rows';

const now = new Date('2026-09-29T12:00:00.000Z');

const filing = (symbol: 'AMD' | 'NVDA', accession: string): CandidatesFile['filings'][number] => ({
  symbol,
  form: '10-K',
  cik: symbol === 'AMD' ? '0000002488' : '0001045810',
  accession,
  filingDate: '2026-02-04',
  reportDate: '2025-12-27',
  acceptedAt: '2026-02-03T23:14:52.000Z',
  url: `https://www.sec.gov/Archives/edgar/data/1/${accession}/doc.htm`,
});

const row = (over: Partial<Row>): Row => ({
  id: 'aaaaaaaaaa:NVDA',
  candidateId: 'aaaaaaaaaa',
  filer: 'AMD',
  company: 'NVDA',
  accession: '0000002488-26-000018',
  section: 'Item 1',
  scope: 'section',
  quote: 'We compete primarily against Nvidia.',
  longQuote: null,
  model: {
    role: 'competitor',
    usesPrevious: false,
    provider: 'groq',
    model: 'openai/gpt-oss-120b',
  },
  research: null,
  borderline: null,
  finnhubPeer: true,
  proposals: [
    {
      key: 'competitor:AMD|NVDA',
      edge: { from: 'NVDA', type: 'competitor_of', to: 'AMD' },
      by: ['model'],
      seeded: false,
    },
  ],
  ...over,
});

// Competitors seen from both sides, one supply relationship with a two sentence span, one row
// with no proposal and one seeded proposal.
const file: CandidatesFile = {
  filings: [filing('AMD', '0000002488-26-000018'), filing('NVDA', '0001045810-26-000021')],
  sentences: [],
  rows: [
    row({}),
    row({
      id: 'bbbbbbbbbb:AMD',
      candidateId: 'bbbbbbbbbb',
      filer: 'NVDA',
      company: 'AMD',
      accession: '0001045810-26-000021',
      quote: 'Our competitors include AMD.',
      proposals: [
        {
          key: 'competitor:AMD|NVDA',
          edge: { from: 'AMD', type: 'competitor_of', to: 'NVDA' },
          by: ['model', 'research'],
          seeded: false,
        },
      ],
    }),
    row({
      id: 'cccccccccc:MU',
      candidateId: 'cccccccccc',
      filer: 'NVDA',
      company: 'MU',
      accession: '0001045810-26-000021',
      quote: 'We purchase memory from Micron.',
      longQuote: 'Memory matters. We purchase memory from Micron.',
      finnhubPeer: false,
      proposals: [
        {
          key: 'supply:MU>NVDA',
          edge: { from: 'MU', type: 'supplier_of', to: 'NVDA' },
          by: ['model'],
          seeded: false,
        },
      ],
    }),
    row({ id: 'dddddddddd:INTC', candidateId: 'dddddddddd', company: 'INTC', proposals: [] }),
    row({
      id: 'eeeeeeeeee:TSM',
      candidateId: 'eeeeeeeeee',
      company: 'TSM',
      proposals: [
        {
          key: 'supply:TSM>AMD',
          edge: { from: 'TSM', type: 'supplier_of', to: 'AMD' },
          by: ['model'],
          seeded: true,
        },
      ],
    }),
  ],
};

describe('groupRelationships', () => {
  it('groups evidence by relationship, supply first, and leaves seeded edges out', () => {
    const groups = groupRelationships(file);
    expect(groups.map((g) => [g.key, g.evidence.map((e) => e.row.id)])).toEqual([
      ['supply:MU>NVDA', ['cccccccccc:MU']],
      ['competitor:AMD|NVDA', ['aaaaaaaaaa:NVDA', 'bbbbbbbbbb:AMD']],
    ]);
  });
});

describe('parseInput', () => {
  const [supply, competitor] = groupRelationships(file);
  if (!supply || !competitor) throw new Error('groups missing');

  it('accepts a numbered quote with the edge that row states', () => {
    expect(parseInput(competitor, '2', now)).toEqual({
      kind: 'review',
      review: {
        key: 'competitor:AMD|NVDA',
        decision: 'accept',
        edge: { from: 'AMD', type: 'competitor_of', to: 'NVDA' },
        rowId: 'bbbbbbbbbb:AMD',
        span: 'sentence',
        quote: 'Our competitors include AMD.',
        decidedAt: now.toISOString(),
      },
    });
  });

  it('takes the two sentence span only when asked and when it exists', () => {
    const input = parseInput(supply, ' 1+ ', now);
    expect(input.kind === 'review' && input.review).toMatchObject({
      span: 'long',
      quote: 'Memory matters. We purchase memory from Micron.',
    });
    expect(parseInput(competitor, '1+', now)).toEqual({
      kind: 'invalid',
      message: 'Evidence 1 has no two sentence span.',
    });
  });

  it('rejects, skips, quits, and asks again on anything else', () => {
    expect(parseInput(supply, 'R', now)).toEqual({
      kind: 'review',
      review: { key: 'supply:MU>NVDA', decision: 'reject', decidedAt: now.toISOString() },
    });
    expect(parseInput(supply, 's', now)).toEqual({ kind: 'skip' });
    expect(parseInput(supply, 'q', now)).toEqual({ kind: 'quit' });
    for (const bad of ['', '0', '2', 'yes', '1++']) {
      expect(parseInput(supply, bad, now).kind).toBe('invalid');
    }
  });
});

describe('record and pending', () => {
  it('keeps one decision per relationship and asks only about the rest', () => {
    const groups = groupRelationships(file);
    const reject: Review = {
      key: 'supply:MU>NVDA',
      decision: 'reject',
      decidedAt: now.toISOString(),
    };
    let reviews = record([], reject);
    expect(pending(groups, reviews).map((g) => g.key)).toEqual(['competitor:AMD|NVDA']);

    const [supply] = groups;
    const again = supply && parseInput(supply, '1', now);
    if (!again || again.kind !== 'review') throw new Error('expected a review');
    reviews = record(reviews, again.review);
    expect(reviews).toHaveLength(1);
    expect(reviews[0]?.decision).toBe('accept');
  });
});

describe('redo', () => {
  it('asks about a decided relationship again but keeps its decision until a new one', () => {
    const groups = groupRelationships(file);
    const reject: Review = {
      key: 'supply:MU>NVDA',
      decision: 'reject',
      decidedAt: now.toISOString(),
    };
    const reviews = record([], reject);
    expect(pending(groups, reviews, 'supply:MU>NVDA').map((g) => g.key)).toEqual([
      'supply:MU>NVDA',
      'competitor:AMD|NVDA',
    ]);
    // A skip or a quit on the redo records nothing, so the earlier decision is still there.
    expect(reviews).toEqual([reject]);
  });
});

describe('staleReviews', () => {
  const groups = groupRelationships(file);
  const [supply] = groups;
  if (!supply) throw new Error('group missing');
  const accepted = parseInput(supply, '1', now);
  if (accepted.kind !== 'review' || accepted.review.decision !== 'accept')
    throw new Error('accept');
  const accept = accepted.review;

  it('passes reviews that match the candidates', () => {
    expect(staleReviews(groups, [accept])).toEqual([]);
  });

  it('reports a relationship no longer proposed, a missing row and a changed quote', () => {
    expect(
      staleReviews(groups, [
        { key: 'supply:AMD>MSFT', decision: 'reject', decidedAt: now.toISOString() },
        { ...accept, rowId: 'zzzzzzzzzz:MU' },
        { ...accept, quote: 'We purchase memory.' },
        { ...accept, span: 'long' },
      ]),
    ).toEqual([
      'supply:AMD>MSFT: no longer proposed',
      'supply:MU>NVDA: row zzzzzzzzzz:MU is no longer evidence for it',
      'supply:MU>NVDA: the quote of row cccccccccc:MU changed',
      'supply:MU>NVDA: the quote of row cccccccccc:MU changed',
    ]);
  });

  it('rejects an accepted edge that does not belong to its relationship', () => {
    expect(
      Review.safeParse({ ...accept, edge: { from: 'NVDA', type: 'supplier_of', to: 'MU' } })
        .success,
    ).toBe(false);
    expect(Review.safeParse(accept).success).toBe(true);
  });
});

describe('renderGroup', () => {
  it('shows every quote in full with its source, the model and the research', () => {
    const [supply] = groupRelationships(file);
    if (!supply) throw new Error('group missing');
    const text = renderGroup(supply, '[1/2]');
    expect(text).toContain('[1/2]  supply:MU>NVDA  (MU supplier_of NVDA)');
    expect(text).toContain('Finnhub peers: no');
    expect(text).toContain('"We purchase memory from Micron."');
    expect(text).toContain(
      '1+ quotes two sentences: "Memory matters. We purchase memory from Micron."',
    );
    expect(text).toContain('model: competes with the filer. research: not in the research');
    expect(text).toContain(
      'https://www.sec.gov/Archives/edgar/data/1/0001045810-26-000021/doc.htm',
    );
  });
});

describe('the committed candidates', () => {
  it('give one group per proposed relationship, with the ASML to TSMC award marked borderline', async () => {
    const candidates = await loadCandidates();
    const groups = groupRelationships(candidates);
    expect(groups.map((g) => g.key).sort()).toEqual([...proposedKeys(candidates.rows)].sort());
    expect(groups.find((g) => g.key === 'supply:ASML>TSM')?.borderline).toBe(true);
    expect(groups.filter((g) => g.borderline).map((g) => g.key)).toEqual(['supply:ASML>TSM']);
    expect(renderGroup(groups[0]!, '[1/1]')).toContain('https://www.sec.gov/');
  });
});
