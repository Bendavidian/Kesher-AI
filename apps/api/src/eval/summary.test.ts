import type { Extraction, PersonaKey } from '@kesher/shared';
import { describe, expect, it } from 'vitest';
import type { ModelRecording } from '../llm/recordings';
import type { EvalItem } from './items';
import type { Label } from './labels';
import { renderReport } from './report';
import type { EvalRun, ItemRun } from './runner';
import { summarizeRun, type EdgeExtractor } from './summary';

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
    items: [
      itemRun(one, ['MSFT'], rel(1, 0, 0), rel(1, 0.8, 0)),
      itemRun(two, ['KO'], rel(0, 0, 1), rel(0, 0, 1)),
      itemRun(poison, [], rel(0, 0, 0), rel(1, 0.8, 0)),
    ],
  };
  const labels = [
    reviewed('1', 'A', 'high'),
    reviewed('1', 'B', 'high'),
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
        label: 'high',
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
    expect(report).toContain('| 1 | Headline 1 | B | high | 0 | 0.8 |');
  });
});
