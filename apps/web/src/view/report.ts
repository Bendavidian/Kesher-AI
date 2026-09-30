import type {
  AgentRun,
  CheckName,
  Claim,
  ClaimStatus,
  CodeClaimOmission,
  PriceAnchor,
  Report,
} from '@kesher/shared';
import { formatDay, joinList } from './format';
import { MODE_LABEL, toolCallsLabel } from './run';
import type { ReportSourceView } from './types';

// The research report screen (docs/UI.md, Research report screen). Evidence lines, status
// labels and the removal reasons are templates over the stored claims and checks; the only
// model text shown is the claim itself.

export const CLAIM_TYPE_LABEL: Record<Claim['type'], string> = {
  fact: 'Fact',
  metric: 'Metric',
  inference: 'Inference',
};

export const CLAIM_TYPE_NOTE: Record<Claim['type'], string> = {
  fact: 'quoted from a source',
  metric: 'checked against market data',
  inference: 'built on other claims',
};

const SUPPORTED_LABEL: Record<Claim['type'], string> = {
  fact: 'Supported',
  metric: 'Matches data',
  inference: 'Premises supported',
};

// Why a claim was removed, by the first check that failed.
const REMOVAL_REASON: Record<CheckName, string> = {
  quote_verbatim: "Its quote wasn't found in the cited source",
  numbers_match: "Its numbers didn't match market data",
  sources_exist: 'It cited a source that does not exist',
  no_advice: 'It read as buy, sell or hold advice, which Kesher never gives',
  premises_supported: 'A claim it builds on was not supported',
  verifier: "The verifier found that its sources don't support it",
};
const FALLBACK_REASON = 'It failed verification';

export interface EvidenceLine {
  // The [n] markers of the cited sources.
  markers: number[];
  text: string;
}

// Every row is a supported claim: nothing else is shown (SPEC.md, Claims and verification).
export interface ClaimRow {
  number: number;
  claim: Claim;
  evidence: EvidenceLine;
  status: string;
}

export interface NumberedSource extends ReportSourceView {
  number: number;
}

export interface ReportView {
  mode: string;
  toolCalls: string;
  counts: Record<ClaimStatus, number>;
  // One segment per claim: supported first, then unverified, then removed.
  bar: ClaimStatus[];
  barLabel: string;
  rows: ClaimRow[];
  openQuestions: string[];
  // One reason per claim with status removed, without a final period, and the ids of those
  // claims in the same order. The removed claims' text is never part of the view.
  removedReasons: string[];
  removedClaimIds: string[];
  // Neutral lines for claims that are not removed but not shown either, such as one the verifier
  // did not check. Never counted as removed.
  hiddenNotes: string[];
  sources: NumberedSource[];
}

const quoted = (quote: string) => `“${quote}”`;

// How a metric's market data was anchored, as the design words it.
function anchorNote(anchor: PriceAnchor): string {
  return anchor.kind === 'previous_close'
    ? `, anchored to the regular close on ${formatDay(anchor.baseTime, 'America/New_York', false)} because the headline came outside the regular session`
    : `, anchored to the price at the headline on ${formatDay(anchor.baseTime, 'America/New_York', false)}`;
}

function evidenceLine(
  claim: Claim,
  numberOf: Map<string, number>,
  sourceNumber: Map<string, number>,
  sources: Map<string, ReportSourceView>,
  anchor: PriceAnchor | null,
): EvidenceLine {
  const markers = claim.sources.flatMap((cited) => sourceNumber.get(cited.sourceId) ?? []);
  const cites = claim.sources.flatMap((cited) => {
    const source = sources.get(cited.sourceId);
    if (!source) return [];
    if (cited.quote) return [`${source.citeLabel}: ${quoted(cited.quote)}`];
    if (source.kind === 'market_data' && anchor)
      return [`${source.citeLabel}${anchorNote(anchor)}.`];
    return [`${source.citeLabel}.`];
  });

  if (claim.type === 'inference') {
    const premises = claim.premises.flatMap((id) => numberOf.get(id) ?? []).map(String);
    const built = `Built on ${premises.length === 1 ? 'claim' : 'claims'} ${joinList(premises)}.`;
    return {
      markers,
      text: [built, 'Shown as a possibility, not as a fact.', ...cites].join(' '),
    };
  }
  if (claim.type === 'metric') {
    return {
      markers,
      text: [...cites, "Timing only, the report doesn't claim a cause."].join(' '),
    };
  }
  return { markers, text: cites.join(' ') };
}

function removalReason(claim: Claim): string {
  const failed = claim.checks.find((check) => !check.passed);
  return (failed && REMOVAL_REASON[failed.name]) ?? FALLBACK_REASON;
}

function barLabel(counts: Record<ClaimStatus, number>): string {
  const parts = [`${counts.supported} ${counts.supported === 1 ? 'claim' : 'claims'} supported`];
  if (counts.unverified > 0) parts.push(`${counts.unverified} not verified`);
  parts.push(`${counts.removed} removed`);
  return parts.join(', ');
}

// Why a claim that verification did not remove is still not shown.
type HiddenReason = 'not_verified' | 'premise_hidden' | 'unlisted_source';

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

const HIDDEN_NOTE: Record<HiddenReason, (count: number) => string> = {
  not_verified: (n) =>
    `${plural(n, 'claim was', 'claims were')} not verified, so ${n === 1 ? 'it is' : 'they are'} not shown`,
  premise_hidden: (n) =>
    `${plural(n, 'inference is', 'inferences are')} hidden because ${n === 1 ? 'a claim it builds on is' : 'claims they build on are'} not shown`,
  unlisted_source: (n) =>
    `${plural(n, 'claim is', 'claims are')} hidden because ${n === 1 ? 'its source' : 'their sources'} can't be listed`,
};

// The claims the screen does not show. Removed: the ones with status removed, with the reason
// from the failed check. Hidden: everything not supported, such as a claim the verifier could not
// check, and a supported claim the display rules cannot back. No evidence, no claim: a claim
// citing a source the report cannot list is hidden, and so is an inference built on a claim that
// is not shown. The api supports an inference only when every premise is supported.
function notShown(
  ordered: Claim[],
  sources: Map<string, ReportSourceView>,
): { removed: Map<string, string>; hidden: Map<string, HiddenReason> } {
  const byId = new Map(ordered.map((claim) => [claim._id, claim]));
  const removed = new Map<string, string>();
  const hidden = new Map<string, HiddenReason>();
  for (const claim of ordered) {
    if (claim.status === 'removed') removed.set(claim._id, removalReason(claim));
    else if (claim.sources.some((cited) => !sources.has(cited.sourceId))) {
      hidden.set(claim._id, 'unlisted_source');
    }
  }
  const out = (id: string) => removed.has(id) || hidden.has(id);
  // Repeat until stable, so an inference built on a hidden inference is hidden too.
  let changed = true;
  while (changed) {
    changed = false;
    for (const claim of ordered) {
      if (claim.type !== 'inference' || out(claim._id)) continue;
      const premises = claim.premises.map((id) => ({ id, claim: byId.get(id) }));
      if (premises.some((p) => out(p.id) || !p.claim)) {
        hidden.set(claim._id, 'premise_hidden');
        changed = true;
      }
    }
  }
  for (const claim of ordered) {
    if (!out(claim._id) && claim.status !== 'supported') hidden.set(claim._id, 'not_verified');
  }
  return { removed, hidden };
}

function hiddenNotes(hidden: Map<string, HiddenReason>): string[] {
  const counts = new Map<HiddenReason, number>();
  for (const reason of hidden.values()) counts.set(reason, (counts.get(reason) ?? 0) + 1);
  return (['not_verified', 'premise_hidden', 'unlisted_source'] as const).flatMap((reason) => {
    const count = counts.get(reason) ?? 0;
    return count > 0 ? [HIDDEN_NOTE[reason](count)] : [];
  });
}

// A claim code writes in every report and left out of this one (Report.omitted, T20). Neutral,
// like a hidden claim: nothing was removed.
function omittedNote(omission: CodeClaimOmission): string {
  if (omission.kind === 'path_fact') {
    return "The filing quote for a link on your path couldn't be read, so it is not shown";
  }
  return omission.reason === 'not_ready'
    ? "The price reaction wasn't available yet, so no price metric is shown"
    : "The market data couldn't be read, so no price metric is shown";
}

// anchor is the event's price reaction anchor from the card, for the metric evidence line.
export function buildReportView(
  report: Report,
  claims: Claim[],
  run: AgentRun,
  sourceList: ReportSourceView[],
  anchor: PriceAnchor | null = null,
): ReportView {
  const byId = new Map(claims.map((claim) => [claim._id, claim]));
  const ordered = report.sections
    .flatMap((section) => section.claimIds)
    .flatMap((id) => byId.get(id) ?? []);
  const sources = new Map(sourceList.map((source) => [source._id, source]));
  const { removed, hidden } = notShown(ordered, sources);
  const shown = ordered.filter((claim) => !removed.has(claim._id) && !hidden.has(claim._id));

  const numberOf = new Map(shown.map((claim, index) => [claim._id, index + 1]));

  // Sources are numbered by first citation among the shown claims, so a source cited only by a
  // removed claim is not listed.
  const sourceNumber = new Map<string, number>();
  for (const claim of shown) {
    for (const cited of claim.sources) {
      if (sources.has(cited.sourceId) && !sourceNumber.has(cited.sourceId)) {
        sourceNumber.set(cited.sourceId, sourceNumber.size + 1);
      }
    }
  }

  // Red only for claims with status removed. A hidden claim counts as not verified, never as
  // supported, so the green segments match the rows.
  const counts: Record<ClaimStatus, number> = { supported: 0, unverified: 0, removed: 0 };
  for (const claim of ordered) {
    if (removed.has(claim._id)) counts.removed += 1;
    else if (hidden.has(claim._id)) counts.unverified += 1;
    else counts[claim.status] += 1;
  }

  return {
    mode: MODE_LABEL[run.mode],
    toolCalls: `${toolCallsLabel(run)} tool calls`,
    counts,
    bar: (['supported', 'unverified', 'removed'] as const).flatMap((status) =>
      Array<ClaimStatus>(counts[status]).fill(status),
    ),
    barLabel: barLabel(counts),
    rows: shown.map((claim, index) => ({
      number: index + 1,
      claim,
      evidence: evidenceLine(claim, numberOf, sourceNumber, sources, anchor),
      status: SUPPORTED_LABEL[claim.type],
    })),
    openQuestions: report.openQuestions,
    removedReasons: [...removed.values()],
    removedClaimIds: [...removed.keys()],
    hiddenNotes: [...hiddenNotes(hidden), ...report.omitted.map(omittedNote)],
    sources: [...sourceNumber].flatMap(([id, number]) => {
      const source = sources.get(id);
      return source ? [{ ...source, number }] : [];
    }),
  };
}
