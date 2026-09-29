import { Claim, normalizeText, type CheckName, type CheckResult } from '@kesher/shared';
import type { DraftClaim, ReportDraft } from './draft';

// The deterministic checks of T08 (SPEC.md Claims and verification). Code decides every status:
// a claim that fails a check is removed; one that passes stays unverified until the verifier
// (T14) supports it. Nothing here calls a model.

// A source a tool returned in this run, read from the database by id.
export interface SeenSource {
  _id: string;
  title: string;
  // null for filings, whose text lives in FilingChunk.
  text: string | null;
  // Filing text a tool returned for this source in this run: search_filings passages and the
  // reviewed evidence quotes of get_company_relationships (SPEC.md decision log, T13).
  passages: readonly string[];
}

export interface CheckContext {
  seen: ReadonlyMap<string, SeenSource>;
  reportId: string;
  newId: () => string;
  now: Date;
}

export interface CheckedDraft {
  // Kept and removed claims, in draft order.
  claims: Claim[];
  // Draft claims that cannot form a valid Claim, such as a fact without a quote. Never stored.
  dropped: { key: string; reason: string }[];
  // For each check, the ids of the claims it removed.
  removedBy: Record<'sources_exist' | 'quote_verbatim' | 'premises_supported', string[]>;
}

// A shorter quote proves too little: a single name is found in almost any source.
export const MIN_QUOTE_CHARS = 20;

// Verbatim after the normalization the stored text went through: whitespace and entities only,
// never case or punctuation.
export function quoteFound(quote: string, source: SeenSource): boolean {
  const wanted = normalizeText(quote);
  if (wanted.length < MIN_QUOTE_CHARS) return false;
  return (
    normalizeText(source.title).includes(wanted) ||
    (source.text !== null && normalizeText(source.text).includes(wanted)) ||
    source.passages.some((passage) => normalizeText(passage).includes(wanted))
  );
}

const result = (name: CheckName, failures: string[]): CheckResult => ({
  name,
  passed: failures.length === 0,
  detail: failures.length === 0 ? null : failures.join('; '),
});

function sourceChecks(draft: DraftClaim, seen: CheckContext['seen']): CheckResult[] {
  if (draft.sources.length === 0) return [];
  const missing = draft.sources.map((s) => s.sourceId).filter((id) => !seen.has(id));
  const checks = [
    result(
      'sources_exist',
      missing.length === 0 ? [] : [`not returned by a tool in this run: ${missing.join(', ')}`],
    ),
  ];
  const quoted = draft.sources.filter((s) => s.quote !== undefined);
  if (quoted.length > 0) {
    const notFound = quoted
      .filter((s) => {
        const source = seen.get(s.sourceId);
        return !source || !quoteFound(s.quote ?? '', source);
      })
      .map((s) =>
        normalizeText(s.quote ?? '').length < MIN_QUOTE_CHARS
          ? `quote shorter than ${MIN_QUOTE_CHARS} characters`
          : `quote not found in source ${s.sourceId}`,
      );
    checks.push(result('quote_verbatim', notFound));
  }
  return checks;
}

export function checkDraft(draft: ReportDraft, ctx: CheckContext): CheckedDraft {
  const idOf = new Map(draft.claims.map((c) => [c.key, ctx.newId()]));
  const dropped: CheckedDraft['dropped'] = [];
  const built = new Map<string, Claim>();
  const unknownPremises = new Map<string, string[]>();

  for (const draftClaim of draft.claims) {
    const checks = sourceChecks(draftClaim, ctx.seen);
    const known = draftClaim.premises.filter((k) => k !== draftClaim.key && idOf.has(k));
    if (draftClaim.type === 'inference') {
      const unknown = draftClaim.premises.filter((k) => !known.includes(k));
      if (unknown.length > 0) unknownPremises.set(draftClaim.key, unknown);
    }
    const candidate = Claim.safeParse({
      _id: idOf.get(draftClaim.key),
      reportId: ctx.reportId,
      type: draftClaim.type,
      text: draftClaim.text,
      status: checks.every((c) => c.passed) ? 'unverified' : 'removed',
      checks,
      sources: draftClaim.sources.map((s) => ({ sourceId: s.sourceId, quote: s.quote ?? null })),
      // Only an inference has premises; the flat draft lets the model send them on any type.
      premises: draftClaim.type === 'inference' ? known.map((k) => idOf.get(k)) : [],
      createdAt: ctx.now,
    });
    if (candidate.success) {
      built.set(draftClaim.key, candidate.data);
    } else {
      dropped.push({
        key: draftClaim.key,
        reason: candidate.error.issues[0]?.message ?? 'invalid',
      });
    }
  }

  // An inference stands only on kept premises. Repeat until nothing changes, so a chain of
  // inferences falls with its first removed premise.
  const premiseFailures = new Map<string, string[]>();
  for (const [key, unknown] of unknownPremises) {
    if (built.has(key))
      premiseFailures.set(
        key,
        unknown.map((k) => `premise ${k} is not in the report`),
      );
  }
  const draftByKey = new Map(draft.claims.map((c) => [c.key, c]));
  for (let changed = true; changed;) {
    changed = false;
    for (const [key, claim] of built) {
      if (claim.type !== 'inference' || premiseFailures.has(key)) continue;
      const fallen = (draftByKey.get(key)?.premises ?? []).filter((k) => {
        const premise = built.get(k);
        return idOf.has(k) && (!premise || premise.status === 'removed' || premiseFailures.has(k));
      });
      if (fallen.length > 0) {
        premiseFailures.set(
          key,
          fallen.map((k) => `premise ${k} was removed`),
        );
        changed = true;
      }
    }
  }

  const removedBy: CheckedDraft['removedBy'] = {
    sources_exist: [],
    quote_verbatim: [],
    premises_supported: [],
  };
  const claims = [...built.entries()].map(([key, claim]) => {
    const failures = premiseFailures.get(key);
    const checks = failures
      ? [...claim.checks, result('premises_supported', failures)]
      : claim.checks;
    for (const check of checks) {
      if (!check.passed && check.name in removedBy) {
        removedBy[check.name as keyof typeof removedBy].push(claim._id);
      }
    }
    const status: Claim['status'] = checks.every((c) => c.passed) ? claim.status : 'removed';
    return { ...claim, checks, status };
  });

  return { claims, dropped, removedBy };
}
