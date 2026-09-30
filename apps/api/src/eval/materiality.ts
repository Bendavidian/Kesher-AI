import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  withInverse,
  type Relationship,
  type RelationshipType,
  type UniverseSymbol,
} from '@kesher/shared';
import { z } from 'zod';
import { relationshipKey } from '../graph/edges';
import type { Review } from '../graph/review';
import type { CandidatesFile } from '../graph/rows';
import { EDGES, FILINGS } from '../seed/config';
import { EVAL_DIR } from './dataset';

// The materiality flag of T16 part 2, for the eval only: the user's call, per direction of each
// reviewed edge, whether news about the edge's from company is material to holders of its to
// company (major) or not (minor). Paths run from the event company to the holding, so the
// direction is the one scoring reads. Nothing in the product reads this file: the eval scores the
// same items again with minor edges weighted lower and only proposes (SPEC.md decision log, T16).

export const MATERIALITY_PATH = resolve(EVAL_DIR, 'materiality.json');

export const MATERIALITY_LEVELS = ['major', 'minor'] as const;
export const MaterialityLevel = z.enum(MATERIALITY_LEVELS);
export type MaterialityLevel = z.infer<typeof MaterialityLevel>;

export const MaterialityFlag = z.strictObject({
  // "AMD supplier_of MSFT": the directed edge, as edgeId writes it.
  edge: z.string().regex(/^[A-Z]+ (supplier_of|customer_of|competitor_of) [A-Z]+$/),
  level: MaterialityLevel,
  decidedAt: z.iso.datetime(),
});
export type MaterialityFlag = z.infer<typeof MaterialityFlag>;

export const MaterialityFile = z.strictObject({ flags: z.array(MaterialityFlag) });

// The factors a minor edge's weight is multiplied by in the experiment; 1 is today's scoring.
export const MINOR_FACTORS = [1, 0.5, 0.25] as const;

interface Ends {
  from: UniverseSymbol;
  type: RelationshipType;
  to: UniverseSymbol;
}

export const edgeId = ({ from, type, to }: Ends) => `${from} ${type} ${to}`;

export interface DirectedEdge extends Ends {
  id: string;
  // The relationship both directions belong to (relationshipKey).
  key: string;
  quote: string;
  url: string;
  seeded: boolean;
}

// Every reviewed edge in both directions: the six seeded edges and the relationships accepted in
// data/graph/reviews.json, each with its inverse, as the seed and graph:apply store them. Sorted
// by relationship, then direction, so the CLI asks both directions of one relationship together.
export function reviewedEdges(file: CandidatesFile, reviews: readonly Review[]): DirectedEdge[] {
  const filings = new Map(file.filings.map((f) => [f.accession, f]));
  const rows = new Map(file.rows.map((r) => [r.id, r]));
  const stated: { edge: Ends; quote: string; url: string; seeded: boolean }[] = EDGES.map((e) => ({
    edge: { from: e.from, type: e.type, to: e.to },
    quote: e.quote,
    url: FILINGS[e.filing].source.url,
    seeded: true,
  }));
  for (const review of reviews) {
    if (review.decision !== 'accept') continue;
    const row = rows.get(review.rowId);
    const filing = row && filings.get(row.accession);
    if (!filing) throw new Error(`review ${review.key}: no filing for row ${review.rowId}`);
    stated.push({ edge: review.edge, quote: review.quote, url: filing.url, seeded: false });
  }
  const byId = new Map<string, DirectedEdge>();
  for (const { edge, quote, url, seeded } of stated) {
    for (const directed of withInverse(edge)) {
      const id = edgeId(directed);
      if (!byId.has(id)) {
        byId.set(id, { ...directed, id, key: relationshipKey(directed), quote, url, seeded });
      }
    }
  }
  return [...byId.values()].sort((a, b) => a.key.localeCompare(b.key) || a.id.localeCompare(b.id));
}

export async function loadMateriality(path = MATERIALITY_PATH): Promise<MaterialityFlag[]> {
  if (!existsSync(path)) return [];
  return MaterialityFile.parse(JSON.parse(await readFile(path, 'utf8'))).flags;
}

// One line per flag that names no reviewed edge or repeats one; the eval refuses to run on them.
export function checkMateriality(
  flags: readonly MaterialityFlag[],
  edges: readonly DirectedEdge[],
): string[] {
  const known = new Set(edges.map((e) => e.id));
  const seen = new Set<string>();
  const problems: string[] = [];
  for (const { edge } of flags) {
    if (!known.has(edge)) problems.push(`${edge}: not a reviewed edge`);
    if (seen.has(edge)) problems.push(`${edge}: flagged twice`);
    seen.add(edge);
  }
  return problems;
}

// The edges still to flag, in reviewedEdges order, and the one to flag again.
export function pendingEdges(
  edges: readonly DirectedEdge[],
  flags: readonly MaterialityFlag[],
  redo?: string,
): DirectedEdge[] {
  const done = new Set(flags.map((f) => f.edge));
  return edges.filter((e) => e.id === redo || !done.has(e.id));
}

// Replaces any earlier flag of the same edge; sorted so the file diffs cleanly.
export function recordFlag(
  flags: readonly MaterialityFlag[],
  flag: MaterialityFlag,
): MaterialityFlag[] {
  return [...flags.filter((f) => f.edge !== flag.edge), flag].sort((a, b) =>
    a.edge.localeCompare(b.edge),
  );
}

// The graph with each minor edge's weight multiplied by factor. An edge without a flag keeps its
// weight, so an unfinished review measures only what was decided.
export function weighted(
  graph: readonly Relationship[],
  levels: ReadonlyMap<string, MaterialityLevel>,
  factor: number,
): Relationship[] {
  return graph.map((edge) =>
    levels.get(edgeId(edge)) === 'minor' ? { ...edge, weight: edge.weight * factor } : edge,
  );
}
