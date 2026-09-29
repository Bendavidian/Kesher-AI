import { RelationshipType, UniverseSymbol } from '@kesher/shared';
import { z } from 'zod';
import { EDGES } from '../seed/config';

// An edge reads "from type to": "TSM supplier_of NVDA" means TSMC supplies NVIDIA, in the
// direction the sentence states. Every edge is stored with its inverse (withInverse).
export const EdgeRef = z.strictObject({
  from: UniverseSymbol,
  type: RelationshipType,
  to: UniverseSymbol,
});
export type EdgeRef = z.infer<typeof EdgeRef>;

// The role a sentence in the filer's report gives a company it names, as the model classifies
// it. Code turns the role into an edge; the model never names edge ends or types.
export const ROLES = ['supplies_filer', 'buys_from_filer', 'competitor', 'none'] as const;
export const Role = z.enum(ROLES);
export type Role = z.infer<typeof Role>;

export function roleEdge(
  filer: UniverseSymbol,
  company: UniverseSymbol,
  role: Role,
): EdgeRef | null {
  switch (role) {
    case 'supplies_filer':
      return { from: company, type: 'supplier_of', to: filer };
    case 'buys_from_filer':
      return { from: company, type: 'customer_of', to: filer };
    case 'competitor':
      return { from: company, type: 'competitor_of', to: filer };
    case 'none':
      return null;
  }
}

// One key per relationship, whichever side states it: A customer_of B is B supplier_of A, and
// competitor_of is symmetric. The review and the final count go by this key.
export function relationshipKey(edge: EdgeRef): string {
  switch (edge.type) {
    case 'supplier_of':
      return `supply:${edge.from}>${edge.to}`;
    case 'customer_of':
      return `supply:${edge.to}>${edge.from}`;
    case 'competitor_of':
      return `competitor:${[edge.from, edge.to].sort().join('|')}`;
  }
}

// The six demo edges the seed owns (SPEC.md decision log, T11). T11 never writes these again.
export const SEEDED_KEYS: ReadonlySet<string> = new Set(EDGES.map((edge) => relationshipKey(edge)));
