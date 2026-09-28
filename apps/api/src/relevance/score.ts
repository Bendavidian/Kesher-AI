import {
  UNIVERSE,
  type FeedPath,
  type PathHop,
  type Relationship,
  type Relevance,
  type UniverseSymbol,
} from '@kesher/shared';

// Relevance, SPEC.md Scores: the maximum over all paths from an event company to a holding. A
// direct holding scores 1, one hop scores the edge weight, and two hops score the product of
// both weights times 0.7. Deterministic code only; no model number enters (principle 3).
export const DIRECT_SCORE = 1;
export const TWO_HOP_FACTOR = 0.7;

export interface Scored {
  relevance: Relevance;
  path: FeedPath | null;
}

const UNIVERSE_ORDER = new Map<string, number>(UNIVERSE.map((symbol, index) => [symbol, index]));

// The extracted symbols that are universe companies, once each, in universe order. Anything else
// the model named, such as a benchmark or a company outside the universe, is not a graph node.
export function eventCompanies(symbols: readonly string[]): UniverseSymbol[] {
  const known = symbols.filter((symbol): symbol is UniverseSymbol => UNIVERSE_ORDER.has(symbol));
  return [...new Set(known)].sort((a, b) => UNIVERSE_ORDER.get(a)! - UNIVERSE_ORDER.get(b)!);
}

// Products of weights are rounded so a stored score reads 0.448, not 0.44800000000000006.
const round = (score: number) => Math.round(score * 1e6) / 1e6;

const toHop = (edge: Relationship): PathHop => ({
  from: edge.from,
  to: edge.to,
  type: edge.type,
  weight: edge.weight,
  relationshipId: edge._id,
});

interface Candidate {
  score: number;
  path: FeedPath;
  key: string;
}

// Higher score first, then fewer hops, then a fixed order of event company, holding and edge ids,
// so the same graph always yields the same path.
function better(a: Candidate, b: Candidate): boolean {
  if (a.score !== b.score) return a.score > b.score;
  if (a.path.hops.length !== b.path.hops.length) return a.path.hops.length < b.path.hops.length;
  return a.key < b.key;
}

// The best path from any event company to any holding within two hops. Only reviewed edges are
// used (no evidence, no edge), and no path visits a company twice.
export function bestPath(
  companies: readonly UniverseSymbol[],
  holdings: readonly UniverseSymbol[],
  edges: readonly Relationship[],
): Scored {
  const held = new Set(holdings);
  const outgoing = new Map<UniverseSymbol, Relationship[]>();
  for (const edge of edges) {
    if (!edge.evidence.reviewed) continue;
    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge]);
  }

  const candidates: Candidate[] = [];
  const consider = (eventCompany: UniverseSymbol, hops: Relationship[], score: number) => {
    const holding = hops.at(-1)?.to ?? eventCompany;
    candidates.push({
      score: round(score),
      path: { eventCompany, holding, hops: hops.map(toHop) },
      key: [eventCompany, holding, ...hops.map((hop) => hop._id)].join('|'),
    });
  };

  for (const company of companies) {
    if (held.has(company)) consider(company, [], DIRECT_SCORE);
    for (const first of outgoing.get(company) ?? []) {
      if (first.to === company) continue;
      if (held.has(first.to)) consider(company, [first], first.weight);
      for (const second of outgoing.get(first.to) ?? []) {
        if (second.to === company || second.to === first.to) continue;
        if (held.has(second.to)) {
          consider(company, [first, second], first.weight * second.weight * TWO_HOP_FACTOR);
        }
      }
    }
  }

  const best = candidates.reduce<Candidate | null>(
    (current, candidate) => (!current || better(candidate, current) ? candidate : current),
    null,
  );
  return best ? { relevance: best.score, path: best.path } : { relevance: 0, path: null };
}
