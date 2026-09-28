import { randomUUID } from 'node:crypto';
import { Relationship, type UniverseSymbol } from '@kesher/shared';
import { describe, expect, it } from 'vitest';
import { buildRelationships } from '../seed/build';
import { FILINGS, PERSONAS } from '../seed/config';
import { bestPath, eventCompanies, TWO_HOP_FACTOR } from './score';

// The seeded graph: six reviewed edges, each stored with its inverse.
const sourceIds = new Map(Object.values(FILINGS).map((f) => [f.source.externalId, randomUUID()]));
const EDGES = buildRelationships(new Date('2026-09-28T12:00:00Z'), sourceIds);

const held = (index: number): UniverseSymbol[] =>
  PERSONAS[index]!.holdings.map((holding) => holding.symbol);
const A = held(0); // NVDA, MSFT, AMZN
const B = held(1); // AMD, AVGO, TSM, ASML
const C = held(2); // KO, JNJ, XOM

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
    expect(bestPath(['TSM'], B, EDGES)).toEqual({
      relevance: 1,
      path: { eventCompany: 'TSM', holding: 'TSM', hops: [] },
    });
    expect(bestPath(['TSM'], A, EDGES)).toEqual({
      relevance: 0.8,
      path: { eventCompany: 'TSM', holding: 'NVDA', hops: [hop('TSM', 'NVDA', 'supplier_of')] },
    });
    expect(bestPath(['TSM'], C, EDGES)).toEqual({ relevance: 0, path: null });
  });

  it('reaches A from AMD news through the competitor edge to NVDA', () => {
    expect(bestPath(['AMD'], A, EDGES)).toEqual({
      relevance: 0.6,
      path: { eventCompany: 'AMD', holding: 'NVDA', hops: [hop('AMD', 'NVDA', 'competitor_of')] },
    });
  });

  it('reaches a TSM holder from NVDA news through the inverse customer edge', () => {
    // NVDA competitor_of AMD also reaches B, at 0.6; the customer edge wins at 0.8.
    expect(bestPath(['NVDA'], B, EDGES)).toEqual({
      relevance: 0.8,
      path: { eventCompany: 'NVDA', holding: 'TSM', hops: [hop('NVDA', 'TSM', 'customer_of')] },
    });
  });

  it('scores two hops as the product of both weights times 0.7', () => {
    expect(TWO_HOP_FACTOR).toBe(0.7);
    expect(bestPath(['LRCX'], A, EDGES)).toEqual({
      relevance: 0.448,
      path: {
        eventCompany: 'LRCX',
        holding: 'NVDA',
        hops: [hop('LRCX', 'TSM', 'supplier_of'), hop('TSM', 'NVDA', 'supplier_of')],
      },
    });
  });

  it('stops at two hops', () => {
    // INTC competes with AMD, which TSM supplies, which LRCX supplies: three hops to LRCX.
    expect(bestPath(['INTC'], ['LRCX'], EDGES)).toEqual({ relevance: 0, path: null });
  });

  it('prefers a direct holding over any path through the graph', () => {
    // TSM -> NVDA -> TSM is a cycle and never a path; the holding itself scores 1.
    expect(bestPath(['TSM'], ['TSM', 'NVDA'], EDGES)).toEqual({
      relevance: 1,
      path: { eventCompany: 'TSM', holding: 'TSM', hops: [] },
    });
  });

  it('takes the maximum over all event companies', () => {
    expect(bestPath(['KO', 'TSM'], A, EDGES).relevance).toBe(0.8);
    expect(bestPath(['KO', 'TSM'], C, EDGES)).toEqual({
      relevance: 1,
      path: { eventCompany: 'KO', holding: 'KO', hops: [] },
    });
  });

  it('breaks ties deterministically: fewer hops, then event company, holding and edge ids', () => {
    // B holds AMD and AVGO; TSM supplies both at 0.8. AMD sorts before AVGO.
    const tied = bestPath(['TSM'], ['AVGO', 'AMD'], EDGES);
    expect(tied.path?.holding).toBe('AMD');
    expect(bestPath(['TSM'], ['AMD', 'AVGO'], [...EDGES].reverse())).toEqual(tied);
  });
});

describe('bestPath evidence rule', () => {
  it('never uses an unreviewed edge', () => {
    const unreviewed = EDGES.map((edge) =>
      Relationship.parse({ ...edge, evidence: { ...edge.evidence, reviewed: false } }),
    );
    expect(bestPath(['TSM'], A, unreviewed)).toEqual({ relevance: 0, path: null });
  });
});

describe('eventCompanies', () => {
  it('keeps universe symbols once, in a stable order', () => {
    expect(eventCompanies(['TSM', 'SSNLF', 'NVDA', 'TSM', 'SPY'])).toEqual(['NVDA', 'TSM']);
    expect(eventCompanies([])).toEqual([]);
  });
});
