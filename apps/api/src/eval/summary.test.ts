import { relevanceBand, type Extraction, type PersonaKey, type Relationship } from '@kesher/shared';
import { describe, expect, it } from 'vitest';
import type { ModelRecording } from '../llm/recordings';
import type { EvalItem } from './items';
import type { Label } from './labels';
import { renderReport } from './report';
import { pathKindOf, pathText, type EvalRun, type ItemRun } from './runner';
import { BAND_SETS, bandWith, summarizeRun, type EdgeExtractor } from './summary';

const now = new Date('2026-09-29T12:00:00.000Z');

const news = (id: number, symbols: string[]) => ({
  id,
  headline: `Headline ${id}`,
  summary: '',
  author: 'Benzinga Newsdesk',
  created_at: '2024-12-12T11:42:24Z',
  updated_at: '2024-12-12T11:42:24Z',
  url: 'https://www.benzinga.com/x',
  symbols,
  source: 'benzinga',
});

const extraction = (symbols: string[], importance: number): Extraction => ({
  companies: symbols.map((symbol) => ({ symbol, impact: 'negative' as const })),
  eventType: 'other',
  themes: [],
  importance: importance,
  provider: 'groq',
  model: 'openai/gpt-oss-120b',
  extractedAt: now,
});

const models = {
  externalId: '1',
  recordedAt: now.toISOString(),
  screen: { model: 'guard', input: 'x', chunks: ['0.001'] },
  extraction: {
    provider: 'groq',
    model: 'openai/gpt-oss-120b',
    text: '{}',
    usage: { inputTokens: 600, outputTokens: 200, totalTokens: 800 },
  },
} satisfies ModelRecording;

const holdings: EvalRun['holdings'] = {
  A: ['NVDA', 'MSFT', 'AMZN'],
  B: ['AMD', 'AVGO', 'TSM', 'ASML'],
  C: ['KO', 'JNJ', 'XOM'],
};

const rel = (A: number, B: number, C: number): Record<PersonaKey, number> => ({ A, B, C });

function itemRun(
  item: EvalItem,
  extracted: string[],
  relevance: Record<PersonaKey, number>,
  taggedOnly: Record<PersonaKey, number>,
): ItemRun {
  return {
    item,
    outcome: {
      outcome: 'processed',
      sourceId: 's',
      eventId: 'e',
      sourceCreated: true,
      eventCreated: true,
    },
    screen: null,
    tagged: item.item.symbols,
    extraction: extraction(extracted, 3),
    relevance,
    taggedOnly,
    starts: [],
    graph: [],
    paths: { A: null, B: null, C: null },
    pathKinds: { A: 'none', B: 'none', C: 'none' },
    models,
    codeMs: 1,
  };
}

const real = (id: number, symbols: string[]): EvalItem => ({
  kind: 'real',
  id: String(id),
  event: {
    id: String(id),
    symbol: symbols[0]!,
    createdAt: '2024-12-12T11:42:24Z',
    updatedAt: '2024-12-12T11:42:24Z',
    type: 'analyst_action',
  },
  item: news(id, symbols),
});

const reviewed = (sourceId: string, persona: PersonaKey, level: Label['level']): Label => ({
  sourceId,
  persona,
  level,
  status: 'reviewed',
  proposed: level,
  decidedAt: now.toISOString(),
});

const edges: EdgeExtractor = {
  relationships: 0,
  accepted: 0,
  model: { proposed: 0, accepted: 0 },
  research: { proposed: 0, accepted: 0 },
  acceptedNotByModel: [],
};

describe('summarizeRun, start node rules', () => {
  // Item 1 tags NVDA and MSFT but the extraction named only MSFT: today NVDA is no start node,
  // so the rules differ for B, which reaches NVDA through TSM. Item 2 is the same under both.
  const one = real(1, ['NVDA', 'MSFT']);
  const two = real(2, ['KO']);
  const poison: EvalItem = {
    kind: 'poisoned',
    id: '9000000001',
    poison: {
      id: '9000000001',
      baselineId: '1',
      kind: 'system_prompt',
      target: 'x',
      injection: 'x',
    },
    item: news(9000000001, ['NVDA', 'MSFT']),
  };
  const run: EvalRun = {
    startedAt: now,
    relationships: 0,
    holdings,
    items: [
      itemRun(one, ['MSFT'], rel(1, 0, 0), rel(1, 0.8, 0)),
      itemRun(two, ['KO'], rel(0, 0, 1), rel(0, 0, 1)),
      itemRun(poison, [], rel(0, 0, 0), rel(1, 0.8, 0)),
    ],
  };
  const labels = [
    reviewed('1', 'A', 'high'),
    reviewed('1', 'B', 'medium'),
    reviewed('1', 'C', 'none'),
    reviewed('2', 'A', 'none'),
    reviewed('2', 'B', 'none'),
    reviewed('2', 'C', 'high'),
  ];
  const summary = summarizeRun(run, labels, edges);

  it('scores each rule against the reviewed labels', () => {
    expect(summary.startNodes.current.B).toMatchObject({ agree: 1, total: 2 });
    expect(summary.startNodes.taggedOnly.B).toMatchObject({ agree: 2, total: 2 });
    expect(summary.startNodes.current.A.agree).toBe(summary.startNodes.taggedOnly.A.agree);
  });

  it('lists the pairs where the rules differ, with the label', () => {
    expect(summary.startNodes.differences).toEqual([
      {
        sourceId: '1',
        headline: 'Headline 1',
        persona: 'B',
        label: 'medium',
        current: 0,
        taggedOnly: 0.8,
      },
    ]);
  });

  it('compares a poisoned copy under both rules', () => {
    expect(summary.injection[0]).toMatchObject({
      id: '9000000001',
      taggedOnlyMoved: [],
      outcome: { removedSymbols: ['MSFT'], relevanceChanged: ['A'] },
    });
  });

  it('renders both rules and the differences', () => {
    const report = renderReport(summary, { status: 'skipped', reason: 'test' });
    expect(report).toContain('### Start node rules');
    expect(report).toContain('| B | 1 of 2 (50%) | 2 of 2 (100%) |');
    expect(report).toContain('| 1 | Headline 1 | B | medium | 0 | 0.8 |');
  });
});

describe('bandWith', () => {
  const [placeholder, from04, decided, highAt1] = BAND_SETS;

  it('keeps 0 at none and both thresholds inclusive', () => {
    for (const set of BAND_SETS) expect(bandWith(set, 0, 5)).toBe('none');
    expect(bandWith(from04!, 0.8, null)).toBe('high');
    expect(bandWith(from04!, 0.4, null)).toBe('medium');
    expect(bandWith(from04!, 0.399, null)).toBe('none');
    expect(bandWith(highAt1!, 0.8, null)).toBe('medium');
    expect(bandWith(highAt1!, 1, null)).toBe('high');
    expect(bandWith(placeholder!, 0.8, null)).toBe('high');
    expect(bandWith(decided!, 0.8, null)).toBe('medium');
    expect(bandWith(decided!, 0.001, null)).toBe('medium');
  });

  it('calls a supply hop high only with importance 4 or more in the last set', () => {
    const withImportance = BAND_SETS[4]!;
    expect(bandWith(withImportance, 1, 1)).toBe('high');
    expect(bandWith(withImportance, 0.8, 4)).toBe('high');
    expect(bandWith(withImportance, 0.8, 3)).toBe('medium');
    expect(bandWith(withImportance, 0.8, null)).toBe('medium');
    expect(bandWith(withImportance, 0.6, 5)).toBe('medium');
    expect(bandWith(withImportance, 0.336, 5)).toBe('none');
  });

  it('gives relevanceBand for the decided set, and only that one is marked', () => {
    expect(BAND_SETS.filter((set) => set.decided)).toEqual([decided]);
    for (let score = 0; score <= 1; score += 0.001) {
      expect(bandWith(decided!, score, null)).toBe(relevanceBand(score));
    }
  });
});

describe('pathKindOf', () => {
  const hop = (type: 'supplier_of' | 'customer_of' | 'competitor_of') => ({
    from: 'TSM' as const,
    to: 'NVDA' as const,
    type,
    weight: 0.8,
    evidence: {
      sourceId: 's',
      quote: 'q',
      filingDate: now,
      url: 'https://www.sec.gov/x',
      reviewed: true,
    },
  });
  const path = (hops: ReturnType<typeof hop>[]) =>
    ({ eventCompany: 'TSM', holding: 'NVDA', hops }) as unknown as Parameters<typeof pathKindOf>[0];

  it('names no path, the holding itself, one hop by type and two hops', () => {
    expect(pathKindOf(null)).toBe('none');
    expect(pathKindOf(path([]))).toBe('direct');
    expect(pathKindOf(path([hop('supplier_of')]))).toBe('supplier_of');
    expect(pathKindOf(path([hop('competitor_of'), hop('customer_of')]))).toBe('two_hops');
    expect(pathText(path([hop('supplier_of')]))).toBe('TSM supplier_of NVDA');
    expect(pathText(null)).toBeNull();
  });
});

describe('summarizeRun, labels by path and band sets', () => {
  const one = real(1, ['TSM']);
  const two = real(2, ['NVDA']);
  const run: EvalRun = {
    startedAt: now,
    relationships: 0,
    holdings,
    items: [
      {
        ...itemRun(one, ['TSM'], rel(0.8, 1, 0), rel(0.8, 1, 0)),
        pathKinds: { A: 'supplier_of', B: 'direct', C: 'none' },
      },
      {
        ...itemRun(two, ['NVDA'], rel(1, 0.8, 0), rel(1, 0.8, 0)),
        pathKinds: { A: 'direct', B: 'customer_of', C: 'none' },
      },
    ],
  };
  // A on item 2 is only proposed, so it counts nowhere.
  const labels: Label[] = [
    reviewed('1', 'A', 'medium'),
    reviewed('1', 'B', 'high'),
    reviewed('1', 'C', 'none'),
    { sourceId: '2', persona: 'A', level: 'none', status: 'proposed', reason: 'x' },
    reviewed('2', 'B', 'high'),
    reviewed('2', 'C', 'none'),
  ];
  const summary = summarizeRun(run, labels, edges);

  it('counts reviewed labels by path kind', () => {
    const byKind = Object.fromEntries(summary.byPathKind.map((k) => [k.kind, k]));
    expect(byKind.direct).toMatchObject({ pairs: 1, labels: { high: 1, medium: 0, none: 0 } });
    expect(byKind.supplier_of).toMatchObject({ pairs: 1, labels: { high: 0, medium: 1, none: 0 } });
    expect(byKind.customer_of).toMatchObject({ pairs: 1, labels: { high: 1, medium: 0, none: 0 } });
    expect(byKind.none).toMatchObject({ pairs: 2, labels: { high: 0, medium: 0, none: 2 } });
    for (const k of summary.byPathKind) {
      expect(k.pairs).toBe(k.labels.high + k.labels.medium + k.labels.none);
    }
  });

  it('scores every band set on the reviewed labels only', () => {
    const [placeholder, , , highAt1] = summary.bandSets;
    // 5 reviewed pairs. The T05 placeholder reads the 0.8 supplier hop high against medium.
    expect(placeholder!.total).toMatchObject({ agree: 4, total: 5 });
    // High at 1 fixes it and breaks the 0.8 customer hop labeled high.
    expect(highAt1!.total).toMatchObject({ agree: 4, total: 5 });
    expect(highAt1!.byPersona.A).toMatchObject({ agree: 1, total: 1 });
    expect(highAt1!.byPersona.B).toMatchObject({ agree: 1, total: 2 });
  });
});

describe('summarizeRun, market wraps', () => {
  // A wrap tagged NVDA and KO whose extraction names nobody: no card today, one per holder under
  // tagged only.
  const wrap: EvalItem = {
    ...real(3, ['NVDA', 'KO']),
    event: { ...(real(3, ['NVDA', 'KO']) as { event: object }).event, type: 'market_wrap' },
  } as EvalItem;
  const run: EvalRun = {
    startedAt: now,
    relationships: 0,
    holdings,
    items: [
      itemRun(real(1, ['KO']), ['KO'], rel(0, 0, 1), rel(0, 0, 1)),
      itemRun(wrap, [], rel(0, 0, 0), rel(1, 0.8, 1)),
    ],
  };
  const labels = [
    reviewed('1', 'A', 'none'),
    reviewed('1', 'B', 'none'),
    reviewed('1', 'C', 'high'),
    reviewed('3', 'A', 'none'),
    reviewed('3', 'B', 'none'),
    { sourceId: '3', persona: 'C', level: 'none', status: 'proposed', reason: 'x' } as Label,
  ];
  const summary = summarizeRun(run, labels, edges);

  it('keeps wraps out of the core numbers', () => {
    expect(summary.realItems).toBe(1);
    expect(summary.labels).toEqual({ reviewed: 3, proposed: 0 });
    expect(summary.agreement.A.reviewed.total).toBe(1);
    expect(summary.startNodes.differences).toEqual([]);
  });

  it('counts the cards each rule makes and those labeled none', () => {
    expect(summary.wraps).toMatchObject({
      items: 1,
      labels: { reviewed: 2, proposed: 1 },
      current: { cards: 0, cardsLabeledNone: 0, agreement: { agree: 2, total: 2 } },
      taggedOnly: { cards: 3, cardsLabeledNone: 2, agreement: { agree: 0, total: 2 } },
    });
    expect(summary.wraps.rows.map((r) => [r.persona, r.label, r.current, r.taggedOnly])).toEqual([
      ['A', 'none', 0, 1],
      ['B', 'none', 0, 0.8],
      ['C', null, 0, 1],
    ]);
    expect(summary.wraps.rows[0]).toMatchObject({ tagged: ['NVDA', 'KO'], extracted: [] });
  });

  it('renders the wrap section', () => {
    const report = renderReport(summary, { status: 'skipped', reason: 'test' });
    expect(report).toContain('| Tagged only | 3 | 2 | 0 of 2 (0%) |');
  });
});

describe('summarizeRun, materiality', () => {
  const edge = (from: string, type: Relationship['type'], to: string): Relationship => ({
    _id: `${from}-${type}-${to}`,
    from: from as Relationship['from'],
    to: to as Relationship['to'],
    type,
    weight: 0.8,
    evidence: {
      sourceId: 's',
      quote: 'q',
      filingDate: '2026-01-01',
      url: 'https://www.sec.gov/x',
      reviewed: true,
    },
    createdAt: now,
  });
  // A Microsoft item reaches AMD holders through MSFT customer_of AMD, labeled none for B; an
  // Intel item reaches ASML holders through INTC customer_of ASML, labeled high.
  const msft = {
    ...itemRun(real(1, ['MSFT']), ['MSFT'], rel(1, 0.8, 0), rel(1, 0.8, 0)),
    starts: ['MSFT' as const],
    graph: [edge('MSFT', 'customer_of', 'AMD')],
  };
  const intc = {
    ...itemRun(real(2, ['INTC']), ['INTC'], rel(0, 0.8, 0), rel(0, 0.8, 0)),
    starts: ['INTC' as const],
    graph: [edge('INTC', 'customer_of', 'ASML')],
  };
  const run: EvalRun = { startedAt: now, relationships: 0, holdings, items: [msft, intc] };
  const labels = [
    reviewed('1', 'A', 'high'),
    reviewed('1', 'B', 'none'),
    reviewed('1', 'C', 'none'),
    reviewed('2', 'A', 'none'),
    reviewed('2', 'B', 'high'),
    reviewed('2', 'C', 'none'),
  ];
  const flags = [
    { edge: 'MSFT customer_of AMD', level: 'minor' as const, decidedAt: now.toISOString() },
    { edge: 'INTC customer_of ASML', level: 'major' as const, decidedAt: now.toISOString() },
  ];
  const { materiality } = summarizeRun(run, labels, edges, flags);
  const row = (factor: number, bands: string) =>
    materiality.rows.find((r) => r.factor === factor && r.set.name.startsWith(bands))!;

  it('scores the stored graph like the pipeline at factor 1', () => {
    expect(materiality).toMatchObject({ flags: 2, minor: 1, mismatches: 0 });
    expect(materiality.rows).toHaveLength(9);
  });

  it('changes no band under the decided set, whatever the factor', () => {
    expect(row(0.25, 'decided').byPersona.B).toMatchObject({ agree: 0, total: 2 });
    expect(row(0.25, 'decided').bFixed).toEqual([]);
  });

  it('fixes the minor edge labeled none below 0.4, keeping the major one high', () => {
    expect(row(1, 'high from 0.8').bFixed).toEqual(['2/high']);
    expect(row(0.5, 'high from 0.8').bFixed).toEqual(['2/high']);
    expect(row(0.25, 'high from 0.8').bFixed).toEqual(['1/none', '2/high']);
    expect(row(0.25, 'high from 0.8').byPersona.B).toMatchObject({ agree: 2, total: 2 });
    expect(row(0.25, 'high from 0.8').bBroken).toEqual([]);
  });
});
