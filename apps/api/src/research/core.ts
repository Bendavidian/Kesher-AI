import {
  PATH_FACT_KEYS,
  PRICE_METRIC_KEY,
  pathFactText,
  priceMetricFor,
  type CodeClaimOmission,
  type FeedEvidence,
  type FeedPath,
  type PriceReaction,
  type PriceSymbol,
} from '@kesher/shared';
import type { Db } from 'mongodb';
import { assembleParts } from '../feed/cards';
import type { DraftClaim } from './draft';

// The deterministic report core (SPEC.md decision log, T20). Before the model's first turn, code
// writes a fact for each hop of the user's path, quoting the edge's reviewed evidence, and a
// metric from the price reaction. They are drafts like the model's: checkDraft and the verifier
// judge them the same way, and checkDraft marks them origin code.

export interface CodeClaims {
  // e1 and e2 for the hops, in path order, then m1.
  claims: DraftClaim[];
  // The filing Sources the facts cite, and each one's evidence quotes. They join the sources the
  // tools returned, so sources_exist, quote_verbatim and the verifier read the filing through the
  // same quotes a get_company_relationships call would have returned.
  passages: Map<string, string[]>;
  omitted: CodeClaimOmission[];
}

// The path's event company and holding, as the card reads its reaction.
export const pathSubjects = (path: FeedPath): PriceSymbol[] => [
  ...new Set([path.eventCompany, path.holding]),
];

// The reviewed evidence of each hop, loaded the way the card loads it: a hop whose edge is gone,
// unreviewed, or without its filing and filer has none.
export async function pathEvidence(
  db: Db,
  eventId: string,
  path: FeedPath,
): Promise<FeedEvidence[]> {
  if (path.hops.length === 0) return [];
  const [parts] = await assembleParts(db, [{ eventId, path }]);
  return parts?.evidence ?? [];
}

// reaction is null when the market data could not be read.
export function codeClaimsFrom(
  path: FeedPath,
  evidence: readonly FeedEvidence[],
  reaction: PriceReaction | null,
): CodeClaims {
  const claims: DraftClaim[] = [];
  const passages = new Map<string, string[]>();
  const omitted: CodeClaimOmission[] = [];

  path.hops.forEach((hop, index) => {
    const found = evidence.find((e) => e.relationshipId === hop.relationshipId);
    const key = PATH_FACT_KEYS[index];
    if (!found || !key) {
      omitted.push({ kind: 'path_fact', reason: 'no_evidence' });
      return;
    }
    const sourceId = found.filing.sourceId;
    claims.push({
      key,
      type: 'fact',
      text: pathFactText(found),
      sources: [{ sourceId, quote: found.quote }],
      premises: [],
      figures: [],
    });
    passages.set(sourceId, [...(passages.get(sourceId) ?? []), found.quote]);
  });

  const metric = reaction
    ? priceMetricFor(reaction, pathSubjects(path))
    : ({ ok: false, reason: 'unavailable' } as const);
  if (metric.ok) {
    // No source of its own: checkDraft adds the market_data Source to a metric with figures.
    claims.push({
      key: PRICE_METRIC_KEY,
      type: 'metric',
      text: metric.text,
      sources: [],
      premises: [],
      figures: metric.figures,
    });
  } else {
    omitted.push({ kind: 'price_metric', reason: metric.reason });
  }

  return { claims, passages, omitted };
}
