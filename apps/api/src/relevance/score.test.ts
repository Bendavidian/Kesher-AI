import { randomUUID } from 'node:crypto';
import { Relationship, relevanceBand, type UniverseSymbol } from '@kesher/shared';
import { describe, expect, it } from 'vitest';
import { GATE_MIN_RELEVANCE } from '../research/gate';
import { buildRelationships } from '../seed/build';
import { FILINGS, PERSONAS } from '../seed/config';
import {
  bestPath,
  MENTION_FACTOR,
  startNodes,
  TWO_HOP_FACTOR,
  universeSymbols,
  type StartNode,
} from './score';

// The seeded graph: six reviewed edges, each stored with its inverse.
const sourceIds = new Map(Object.values(FILINGS).map((f) => [f.source.externalId, randomUUID()]));
const EDGES = buildRelationships(new Date('2026-09-28T12:00:00Z'), sourceIds);

const held = (index: number): UniverseSymbol[] =>
  PERSONAS[index]!.holdings.map((holding) => holding.symbol);
const A = held(0); // NVDA, MSFT, AMZN
const B = held(1); // AMD, AVGO, TSM, ASML
const C = held(2); // KO, JNJ, XOM

// Start nodes the extraction names, and start nodes the provider tagged but the extraction did not.
const named = (...symbols: UniverseSymbol[]): StartNode[] =>
  symbols.map((symbol) => ({ symbol, named: true }));
const mentioned = (...symbols: UniverseSymbol[]): StartNode[] =>
  symbols.map((symbol) => ({ symbol, named: false }));

const edgeId = (from: string, to: string, type: string) => {
  const edge = EDGES.find((e) => e.from === from && e.to === to && e.type === type);
  if (!edge) throw new Error(`no seeded edge ${from} ${type} ${to}`);
  return edge._id;
};

const hop = (from: UniverseSymbol, to: UniverseSymbol, type: Relationship['type']) => ({
  from,
  to,
  type,
  weight: type === 'competitor_of' ? 0.6 : 0.8,
  relationshipId: edgeId(from, to, type),
});

describe('bestPath on the seeded graph', () => {
  it('scores the TSMC event 1 for B, 0.8 for A through the supplier edge, and 0 for C', () => {
    expect(bestPath(named('TSM'), B, EDGES)).toEqual({
      relevance: 1,
      path: { eventCompany: 'TSM', named: true, holding: 'TSM', hops: [] },
    });
    expect(bestPath(named('TSM'), A, EDGES)).toEqual({
      relevance: 0.8,
      path: {
        eventCompany: 'TSM',
        named: true,
        holding: 'NVDA',
        hops: [hop('TSM', 'NVDA', 'supplier_of')],
      },
    });
    expect(bestPath(named('TSM'), C, EDGES)).toEqual({ relevance: 0, path: null });
  });

  it('reaches A from AMD news through the competitor edge to NVDA', () => {
    expect(bestPath(named('AMD'), A, EDGES)).toEqual({
      relevance: 0.6,
      path: {
        eventCompany: 'AMD',
        named: true,
        holding: 'NVDA',
        hops: [hop('AMD', 'NVDA', 'competitor_of')],
      },
    });
  });

  it('reaches a TSM holder from NVDA news through the inverse customer edge', () => {
    // NVDA competitor_of AMD also reaches B, at 0.6; the customer edge wins at 0.8.
    expect(bestPath(named('NVDA'), B, EDGES)).toEqual({
      relevance: 0.8,
      path: {
        eventCompany: 'NVDA',
        named: true,
        holding: 'TSM',
        hops: [hop('NVDA', 'TSM', 'customer_of')],
      },
    });
  });

  it('scores two hops as the product of both weights times 0.7', () => {
    expect(TWO_HOP_FACTOR).toBe(0.7);
    expect(bestPath(named('LRCX'), A, EDGES)).toEqual({
      relevance: 0.448,
      path: {
        eventCompany: 'LRCX',
        named: true,
        holding: 'NVDA',
        hops: [hop('LRCX', 'TSM', 'supplier_of'), hop('TSM', 'NVDA', 'supplier_of')],
      },
    });
  });

  it('stops at two hops', () => {
    // INTC competes with AMD, which TSM supplies, which LRCX supplies: three hops to LRCX.
    expect(bestPath(named('INTC'), ['LRCX'], EDGES)).toEqual({ relevance: 0, path: null });
  });

  it('prefers a direct holding over any path through the graph', () => {
    // TSM -> NVDA -> TSM is a cycle and never a path; the holding itself scores 1.
    expect(bestPath(named('TSM'), ['TSM', 'NVDA'], EDGES)).toEqual({
      relevance: 1,
      path: { eventCompany: 'TSM', named: true, holding: 'TSM', hops: [] },
    });
  });

  it('takes the maximum over all event companies', () => {
    expect(bestPath(named('KO', 'TSM'), A, EDGES).relevance).toBe(0.8);
    expect(bestPath(named('KO', 'TSM'), C, EDGES)).toEqual({
      relevance: 1,
      path: { eventCompany: 'KO', named: true, holding: 'KO', hops: [] },
    });
  });

  it('breaks ties deterministically: fewer hops, then event company, holding and edge ids', () => {
    // B holds AMD and AVGO; TSM supplies both at 0.8. AMD sorts before AVGO.
    const tied = bestPath(named('TSM'), ['AVGO', 'AMD'], EDGES);
    expect(tied.path?.holding).toBe('AMD');
    expect(bestPath(named('TSM'), ['AMD', 'AVGO'], [...EDGES].reverse())).toEqual(tied);
  });
});

describe('bestPath from a company the item only mentions', () => {
  it('reads a holding the extraction names as high', () => {
    const scored = bestPath(named('NVDA'), A, EDGES);
    expect(scored).toEqual({
      relevance: 1,
      path: { eventCompany: 'NVDA', named: true, holding: 'NVDA', hops: [] },
    });
    expect(relevanceBand(scored.relevance)).toBe('high');
  });

  it('reads a holding the item only mentions as medium, below the research gate', () => {
    expect(MENTION_FACTOR).toBe(0.5);
    const scored = bestPath(mentioned('NVDA'), A, EDGES);
    expect(scored).toEqual({
      relevance: 0.5,
      path: { eventCompany: 'NVDA', named: false, holding: 'NVDA', hops: [] },
    });
    expect(relevanceBand(scored.relevance)).toBe('medium');
    expect(scored.relevance).toBeLessThan(GATE_MIN_RELEVANCE);
  });

  it('scores a hop from a company the item only mentions at the path score times the factor', () => {
    expect(bestPath(mentioned('TSM'), A, EDGES)).toEqual({
      relevance: 0.4,
      path: {
        eventCompany: 'TSM',
        named: false,
        holding: 'NVDA',
        hops: [hop('TSM', 'NVDA', 'supplier_of')],
      },
    });
    expect(bestPath(mentioned('LRCX'), A, EDGES).relevance).toBe(0.224);
    expect(relevanceBand(bestPath(mentioned('LRCX'), A, EDGES).relevance)).toBe('medium');
  });

  it('takes a named path that scores higher than a mention', () => {
    // AMD named, NVDA only mentioned: the competitor hop at 0.6 beats the mention at 0.5.
    expect(bestPath([...named('AMD'), ...mentioned('NVDA')], A, EDGES)).toEqual({
      relevance: 0.6,
      path: {
        eventCompany: 'AMD',
        named: true,
        holding: 'NVDA',
        hops: [hop('AMD', 'NVDA', 'competitor_of')],
      },
    });
  });

  it('prefers a named path over a mention of the same score, before fewer hops', () => {
    const edges = EDGES.map((edge) =>
      edge.from === 'AMD' && edge.to === 'NVDA'
        ? Relationship.parse({ ...edge, weight: 0.5 })
        : edge,
    );
    // The mention of NVDA scores 0.5 directly; AMD's competitor hop scores 0.5 too.
    expect(bestPath([...mentioned('NVDA'), ...named('AMD')], ['NVDA'], edges)).toEqual({
      relevance: 0.5,
      path: {
        eventCompany: 'AMD',
        named: true,
        holding: 'NVDA',
        hops: [{ ...hop('AMD', 'NVDA', 'competitor_of'), weight: 0.5 }],
      },
    });
  });
});

describe('bestPath evidence rule', () => {
  it('never uses an unreviewed edge', () => {
    const unreviewed = EDGES.map((edge) =>
      Relationship.parse({ ...edge, evidence: { ...edge.evidence, reviewed: false } }),
    );
    expect(bestPath(named('TSM'), A, unreviewed)).toEqual({ relevance: 0, path: null });
  });
});

describe('universeSymbols', () => {
  it('keeps universe symbols once, in a stable order', () => {
    expect(universeSymbols(['TSM', 'SSNLF', 'NVDA', 'TSM', 'SPY'])).toEqual(['NVDA', 'TSM']);
    expect(universeSymbols([])).toEqual([]);
  });
});

describe('startNodes', () => {
  it('starts from every tagged universe company once, named when the extraction names it', () => {
    expect(startNodes(['TSM'], ['TSM', 'NVDA', 'SSNLF', 'SPY', 'TSM'])).toEqual([
      { symbol: 'NVDA', named: false },
      { symbol: 'TSM', named: true },
    ]);
    expect(startNodes([], ['NVDA'])).toEqual([{ symbol: 'NVDA', named: false }]);
  });

  it('never starts from a company only the text names', () => {
    // An article tagged KO whose text names NVDA: NVDA is extracted but is not a start node.
    expect(startNodes(['KO', 'NVDA'], ['KO'])).toEqual([{ symbol: 'KO', named: true }]);
    expect(startNodes(['NVDA'], [])).toEqual([]);
  });
});
