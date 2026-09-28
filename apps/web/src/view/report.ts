import type { AgentRun, Claim, ClaimStatus, Report } from '@kesher/shared';
import { joinList } from './format';
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

const MISSING_SOURCE = 'It cited a source that does not exist';
const UNSUPPORTED_PREMISE = 'A claim it builds on was not supported';

// Why a claim was removed, by the check that failed. T14 owns the check names.
const REMOVAL_REASON: Record<string, string> = {
  quote_verbatim: "Its quote wasn't found in the cited source",
  numbers_match: "Its numbers didn't match market data",
  sources_exist: MISSING_SOURCE,
  premises_supported: UNSUPPORTED_PREMISE,
  verifier: 'The verifier found no support for it',
};
const FALLBACK_REASON = 'It failed verification';

export interface EvidenceLine {
  // The [n] markers of the cited sources.
  markers: number[];
  text: string;
}

export interface ClaimRow {
  number: number;
  claim: Claim;
  evidence: EvidenceLine;
  status: { label: string; supported: boolean };
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
  // One reason per removed claim, without a final period. The removed claims' text is never
  // part of the view.
  removedReasons: string[];
  sources: NumberedSource[];
}

const quoted = (quote: string) => `“${quote}”`;

function evidenceLine(
  claim: Claim,
  numberOf: Map<string, number>,
  sourceNumber: Map<string, number>,
  sources: Map<string, ReportSourceView>,
): EvidenceLine {
  const markers = claim.sources.flatMap((cited) => sourceNumber.get(cited.sourceId) ?? []);
  const cites = claim.sources.flatMap((cited) => {
    const source = sources.get(cited.sourceId);
    if (!source) return [];
    return [cited.quote ? `${source.citeLabel}: ${quoted(cited.quote)}` : `${source.citeLabel}.`];
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
  if (counts.unverified > 0) parts.push(`${counts.unverified} not checked yet`);
  parts.push(`${counts.removed} removed`);
  return parts.join(', ');
}

// The claims the screen does not show, with the reason: the ones verification removed, plus
// any the display rules cannot back. No evidence, no claim: a claim citing a source the report
// cannot list is dropped. An inference is shown only when every premise is supported
// (SPEC.md, Claims and verification).
function dropped(ordered: Claim[], sources: Map<string, ReportSourceView>): Map<string, string> {
  const byId = new Map(ordered.map((claim) => [claim._id, claim]));
  const reasons = new Map<string, string>();
  for (const claim of ordered) {
    if (claim.status === 'removed') reasons.set(claim._id, removalReason(claim));
    else if (claim.sources.some((cited) => !sources.has(cited.sourceId))) {
      reasons.set(claim._id, MISSING_SOURCE);
    }
  }
  // Repeat until stable, so an inference built on a dropped inference is dropped too.
  let changed = true;
  while (changed) {
    changed = false;
    for (const claim of ordered) {
      if (claim.type !== 'inference' || reasons.has(claim._id)) continue;
      const unsupported = claim.premises.some(
        (id) => reasons.has(id) || byId.get(id)?.status !== 'supported',
      );
      if (unsupported) {
        reasons.set(claim._id, UNSUPPORTED_PREMISE);
        changed = true;
      }
    }
  }
  return reasons;
}

export function buildReportView(
  report: Report,
  claims: Claim[],
  run: AgentRun,
  sourceList: ReportSourceView[],
): ReportView {
  const byId = new Map(claims.map((claim) => [claim._id, claim]));
  const ordered = report.sections
    .flatMap((section) => section.claimIds)
    .flatMap((id) => byId.get(id) ?? []);
  const sources = new Map(sourceList.map((source) => [source._id, source]));
  const drops = dropped(ordered, sources);
  const shown = ordered.filter((claim) => !drops.has(claim._id));

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

  const counts: Record<ClaimStatus, number> = { supported: 0, unverified: 0, removed: 0 };
  for (const claim of ordered) counts[drops.has(claim._id) ? 'removed' : claim.status] += 1;

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
      evidence: evidenceLine(claim, numberOf, sourceNumber, sources),
      status:
        claim.status === 'supported'
          ? { label: SUPPORTED_LABEL[claim.type], supported: true }
          : { label: 'Not checked yet', supported: false },
    })),
    openQuestions: report.openQuestions,
    removedReasons: [...drops.values()],
    sources: [...sourceNumber].flatMap(([id, number]) => {
      const source = sources.get(id);
      return source ? [{ ...source, number }] : [];
    }),
  };
}
