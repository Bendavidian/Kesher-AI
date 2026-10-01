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
// both weights times 0.7. A path from a company the item only mentions scores half of that
// (T27). Deterministic code only; no model number enters (principle 3).
export const DIRECT_SCORE = 1;
export const TWO_HOP_FACTOR = 0.7;
// Below 1, so a mention never reads high (relevanceBand), and with it every mention path stays
// below the research gate's GATE_MIN_RELEVANCE of 0.6.
export const MENTION_FACTOR = 0.5;

export interface Scored {
  relevance: Relevance;
  path: FeedPath | null;
}

const UNIVERSE_ORDER = new Map<string, number>(UNIVERSE.map((symbol, index) => [symbol, index]));

// The universe companies among the symbols, once each, in universe order.
export function universeSymbols(symbols: readonly string[]): UniverseSymbol[] {
  const known = symbols.filter((symbol): symbol is UniverseSymbol => UNIVERSE_ORDER.has(symbol));
  return [...new Set(known)].sort((a, b) => UNIVERSE_ORDER.get(a)! - UNIVERSE_ORDER.get(b)!);
}

// A company the graph starts from, and whether the extraction names it.
export interface StartNode {
  symbol: UniverseSymbol;
  named: boolean;
}

// The start nodes of the graph (SPEC.md decision log, T27, which replaces the T05 rule): every
// universe company the provider tagged, named when the extraction also names it. The provider tags
// are the code's check on the model: a company named only in the untrusted text, never tagged by
// the provider, is not a start node, so an injected article cannot pull relevance for another
// company's holders. The extraction only decides whether a tagged company is named, so an
// extraction that leaves a tagged company out lowers its paths to a mention and never removes them.
export function startNodes(extracted: readonly string[], tagged: readonly string[]): StartNode[] {
  const names = new Set(extracted);
  return universeSymbols(tagged).map((symbol) => ({ symbol, named: names.has(symbol) }));
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

// Higher score first, then a path from a named company over a mention, then fewer hops, then a
// fixed order of event company, holding and edge ids, so the same graph always yields the same
// path, and an item's own companies explain a score whenever they reach it.
function better(a: Candidate, b: Candidate): boolean {
  if (a.score !== b.score) return a.score > b.score;
  if (a.path.named !== b.path.named) return a.path.named;
  if (a.path.hops.length !== b.path.hops.length) return a.path.hops.length < b.path.hops.length;
  return a.key < b.key;
}

// The best path from any start node to any holding within two hops. Only reviewed edges are
// used (no evidence, no edge), and no path visits a company twice.
export function bestPath(
  starts: readonly StartNode[],
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
  const consider = (start: StartNode, hops: Relationship[], score: number) => {
    const { symbol: eventCompany, named } = start;
    const holding = hops.at(-1)?.to ?? eventCompany;
    candidates.push({
      score: round(named ? score : score * MENTION_FACTOR),
      path: { eventCompany, named, holding, hops: hops.map(toHop) },
      key: [eventCompany, holding, ...hops.map((hop) => hop._id)].join('|'),
    });
  };

  for (const start of starts) {
    const company = start.symbol;
    if (held.has(company)) consider(start, [], DIRECT_SCORE);
    for (const first of outgoing.get(company) ?? []) {
      if (first.to === company) continue;
      if (held.has(first.to)) consider(start, [first], first.weight);
      for (const second of outgoing.get(first.to) ?? []) {
        if (second.to === company || second.to === first.to) continue;
        if (held.has(second.to)) {
          consider(start, [first, second], first.weight * second.weight * TWO_HOP_FACTOR);
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
