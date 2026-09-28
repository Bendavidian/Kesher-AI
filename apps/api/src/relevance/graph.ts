import { Relationship, type UniverseSymbol } from '@kesher/shared';
import type { Db } from 'mongodb';
import { collection } from '../db/collections';

// SPEC.md Interest graph: traversal stops after 2 hops.
export const MAX_HOPS = 2;

// Every reviewed edge reachable from the given companies within MAX_HOPS, found with
// $graphLookup. Depth 0 matches the edges leaving the companies; each further level follows the
// edge's to end. Edges are stored in both directions, so this reaches both ends of a
// relationship. Unreviewed edges are never loaded (no evidence, no edge).
export async function loadEdges(
  db: Db,
  symbols: readonly UniverseSymbol[],
): Promise<Relationship[]> {
  if (symbols.length === 0) return [];
  const rows = await collection(db, 'companies')
    .aggregate<{ edges: unknown[] }>([
      { $match: { symbol: { $in: [...symbols] } } },
      {
        $graphLookup: {
          from: 'relationships',
          startWith: '$symbol',
          connectFromField: 'to',
          connectToField: 'from',
          as: 'edges',
          maxDepth: MAX_HOPS - 1,
          restrictSearchWithMatch: { 'evidence.reviewed': true },
        },
      },
      { $project: { _id: 0, edges: 1 } },
    ])
    .toArray();
  const byId = new Map<string, Relationship>();
  for (const edge of rows.flatMap((row) => row.edges)) {
    const parsed = Relationship.parse(edge);
    byId.set(parsed._id, parsed);
  }
  return [...byId.values()].sort((a, b) => a._id.localeCompare(b._id));
}
