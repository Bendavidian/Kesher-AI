import type { Relationship } from '@kesher/shared';
import { describe, expect, it } from 'vitest';
import { loadCandidates, loadReviews } from '../graph/review';
import {
  checkMateriality,
  edgeId,
  MaterialityFile,
  pendingEdges,
  recordFlag,
  reviewedEdges,
  weighted,
  type MaterialityFlag,
} from './materiality';

const at = '2026-10-01T10:00:00.000Z';
const flag = (edge: string, level: 'major' | 'minor'): MaterialityFlag => ({
  edge,
  level,
  decidedAt: at,
});

describe('reviewedEdges', async () => {
  const edges = reviewedEdges(await loadCandidates(), await loadReviews());

  it('lists both directions of the 28 reviewed relationships, each once', () => {
    expect(edges).toHaveLength(56);
    expect(new Set(edges.map((e) => e.id)).size).toBe(56);
    expect(new Set(edges.map((e) => e.key)).size).toBe(28);
    expect(edges.filter((e) => e.seeded)).toHaveLength(12);
  });

  it('keeps the two directions of AMD supplying Microsoft apart, next to each other', () => {
    const ids = edges.map((e) => e.id);
    const i = ids.indexOf('AMD supplier_of MSFT');
    expect(i).toBeGreaterThanOrEqual(0);
    expect(ids[i - 1] === 'MSFT customer_of AMD' || ids[i + 1] === 'MSFT customer_of AMD').toBe(
      true,
    );
    const both = edges.filter((e) => e.key === 'supply:AMD>MSFT');
    expect(both.map((e) => e.quote)).toEqual([both[0]!.quote, both[0]!.quote]);
    expect(both[0]!.url).toMatch(/^https:\/\/www\.sec\.gov\//);
  });

  it('refuses a flag for an edge nobody reviewed, or a second flag for one', () => {
    expect(checkMateriality([flag('AMD supplier_of MSFT', 'minor')], edges)).toEqual([]);
    expect(
      checkMateriality(
        [flag('KO supplier_of NVDA', 'major'), flag('TSM supplier_of NVDA', 'major')],
        edges,
      ),
    ).toEqual(['KO supplier_of NVDA: not a reviewed edge']);
    expect(
      checkMateriality(
        [flag('TSM supplier_of NVDA', 'major'), flag('TSM supplier_of NVDA', 'minor')],
        edges,
      ),
    ).toEqual(['TSM supplier_of NVDA: flagged twice']);
  });

  it('asks only about unflagged edges, and again about the one redone', () => {
    const flags = edges.slice(1).map((e) => flag(e.id, 'major'));
    expect(pendingEdges(edges, flags).map((e) => e.id)).toEqual([edges[0]!.id]);
    expect(pendingEdges(edges, flags, edges[3]!.id).map((e) => e.id)).toEqual([
      edges[0]!.id,
      edges[3]!.id,
    ]);
  });
});

describe('the materiality file', () => {
  it('rejects a level other than major or minor, and an edge that is not "FROM type TO"', () => {
    expect(() =>
      MaterialityFile.parse({ flags: [flag('AMD supplier_of MSFT', 'minor')] }),
    ).not.toThrow();
    expect(() =>
      MaterialityFile.parse({
        flags: [{ edge: 'AMD supplier_of MSFT', level: 'low', decidedAt: at }],
      }),
    ).toThrow();
    expect(() => MaterialityFile.parse({ flags: [flag('supply:AMD>MSFT', 'minor')] })).toThrow();
  });

  it('replaces an earlier flag of the same edge and keeps the file sorted', () => {
    let flags = recordFlag([], flag('TSM supplier_of NVDA', 'minor'));
    flags = recordFlag(flags, flag('AMD supplier_of MSFT', 'major'));
    flags = recordFlag(flags, flag('TSM supplier_of NVDA', 'major'));
    expect(flags.map((f) => `${f.edge} ${f.level}`)).toEqual([
      'AMD supplier_of MSFT major',
      'TSM supplier_of NVDA major',
    ]);
  });
});

describe('weighted', () => {
  const edge = (from: string, type: Relationship['type'], to: string, weight: number) =>
    ({ from, type, to, weight }) as Relationship;

  it('multiplies only minor edges and leaves unflagged edges as they are', () => {
    const graph = [
      edge('MSFT', 'customer_of', 'AMD', 0.8),
      edge('AMD', 'supplier_of', 'MSFT', 0.8),
      edge('AMD', 'competitor_of', 'NVDA', 0.6),
    ];
    const levels = new Map([
      ['MSFT customer_of AMD', 'minor' as const],
      ['AMD supplier_of MSFT', 'major' as const],
    ]);
    expect(weighted(graph, levels, 0.5).map((e) => `${edgeId(e)} ${e.weight}`)).toEqual([
      'MSFT customer_of AMD 0.4',
      'AMD supplier_of MSFT 0.8',
      'AMD competitor_of NVDA 0.6',
    ]);
    expect(weighted(graph, levels, 1)).toEqual(graph);
  });
});
