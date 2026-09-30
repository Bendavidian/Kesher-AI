import {
  Claim,
  normalizeText,
  type CheckName,
  type CheckResult,
  type MetricFigure,
  type PriceReaction,
} from '@kesher/shared';
import type { DraftClaim, ReportDraft } from './draft';

// The deterministic checks (SPEC.md Claims and verification). Code decides every status: a claim
// that fails a check is removed; one that passes stays unverified until the verifier supports it
// (verifier.ts). Nothing here calls a model.

// A source a tool returned in this run, read from the database by id.
export interface SeenSource {
  _id: string;
  title: string;
  // null for filings, whose text lives in FilingChunk.
  text: string | null;
}

export interface CheckContext {
  seen: ReadonlyMap<string, SeenSource>;
  reportId: string;
  newId: () => string;
  now: Date;
  // The event's price reaction, computed by code at the event's own time, never at a time the
  // model chose. null when the market data could not be read: a metric's figures then stay
  // unchecked and the metric unverified.
  reaction: PriceReaction | null;
  // The market data Source a metric with figures cites (marketSource.ts). null when the draft
  // has no figures.
  marketSourceId: string | null;
  // Symbols whose market data could not be read after the first read. A metric naming one stays
  // unchecked and unverified, like a metric without any market data.
  unread?: ReadonlySet<string>;
}

// The checks that run before the verifier, in the order they run on each claim.
export const DETERMINISTIC_CHECKS = [
  'sources_exist',
  'quote_verbatim',
  'numbers_match',
  'no_advice',
  'premises_supported',
] as const satisfies readonly CheckName[];
export type DeterministicCheck = (typeof DETERMINISTIC_CHECKS)[number];

export interface CheckedDraft {
  // Kept and removed claims: the code claims first, then the draft in its order.
  claims: Claim[];
  // Each claim's draft key, by claim id, for the details of later checks.
  keys: ReadonlyMap<string, string>;
  // Draft claims that cannot form a valid Claim, such as a fact without a quote. Never stored.
  dropped: { key: string; reason: string }[];
  // For each check, the ids of the claims it removed.
  removedBy: Record<DeterministicCheck, string[]>;
  // The open questions kept, and those dropped for advice language.
  openQuestions: string[];
  droppedQuestions: string[];
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
    (source.text !== null && normalizeText(source.text).includes(wanted))
  );
}

// Buy, sell or hold language and analyst ratings (principle 8). Whole words only, so holders,
// holdings and shareholders pass, and so does a sell-off, which describes a market. It fails
// closed: a fact that says a fund "holds" shares is removed too, which T16 can measure.
const ADVICE =
  /\b(buy|buys|buying|sell(?!-off)|sells|selling|hold|holds|overweight|underweight|outperform|underperform)\b/i;

// The first advice word in the text, or null.
export function containsAdvice(text: string): string | null {
  return ADVICE.exec(text)?.[1] ?? null;
}

// A percentage as written: an optional sign (a true minus, a hyphen or a plus) and digits.
const PERCENT = /([+\-−]?)(\d+(?:\.\d+)?)\s?%/g;

// Every percentage in the text, as written, with the minus normalized to a hyphen.
export function percentagesIn(text: string): string[] {
  return [...text.matchAll(PERCENT)].map(
    ([, sign, digits]) => `${sign === '−' ? '-' : sign}${digits}`,
  );
}

// A percentage in the text matches a figure when the figure, rounded half away from zero to the
// decimals the text shows, equals it. A number with no sign is positive. Integer arithmetic in
// hundredths, since every figure has at most 2 decimals.
export function percentMatches(written: string, figure: number): boolean {
  const match = /^([+\-−]?)(\d+)(?:\.(\d+))?$/.exec(written.trim());
  if (!match) return false;
  const [, sign = '', whole = '0', fraction = ''] = match;
  const negative = sign === '-' || sign === '−';
  const decimals = fraction.length;
  const units = BigInt(whole + fraction) * (negative ? -1n : 1n);
  const hundredths = BigInt(Math.round(figure * 100));
  if (decimals >= 2) return units === hundredths * 10n ** BigInt(decimals - 2);
  const step = 10n ** BigInt(2 - decimals);
  const magnitude = hundredths < 0n ? -hundredths : hundredths;
  const rounded = (magnitude + step / 2n) / step;
  return units === (hundredths < 0n ? -rounded : rounded);
}

const pct = (value: number) => `${value.toFixed(2)}%`;

// Exactly equal to 2 decimals, the precision of the reaction. A figure with more decimals than
// that never matches.
function sameHundredths(actual: number, figure: number): boolean {
  const wanted = figure * 100;
  return (
    Math.abs(wanted - Math.round(wanted)) < 1e-6 && Math.round(wanted) === Math.round(actual * 100)
  );
}

// Each figure must equal the reaction exactly, and each percentage the text gives must be one of
// the figures. The failures, empty when the numbers match.
function numberFailures(text: string, figures: MetricFigure[], reaction: PriceReaction): string[] {
  const failures: string[] = [];
  for (const figure of figures) {
    const row = reaction.rows.find((r) => r.symbol === figure.symbol);
    const index = reaction.windows.findIndex((w) => w.name === figure.window);
    if (!row) failures.push(`the reaction has no ${figure.symbol} row`);
    else if (index < 0) failures.push(`the reaction has no ${figure.window} window`);
    else {
      const actual = row.moves[index]?.pct ?? null;
      if (actual === null) {
        failures.push(`${figure.symbol} ${figure.window} is not available yet`);
      } else if (!sameHundredths(actual, figure.pct)) {
        failures.push(
          `${figure.symbol} ${figure.window} is ${pct(actual)}, not ${pct(figure.pct)}`,
        );
      }
    }
  }
  const written = percentagesIn(text);
  if (written.length === 0) failures.push('the text gives no percentage');
  for (const value of written) {
    if (!figures.some((figure) => percentMatches(value, figure.pct))) {
      failures.push(`the text gives ${value}%, which is none of its figures`);
    }
  }
  return failures;
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

function claimChecks(draft: DraftClaim, ctx: CheckContext): CheckResult[] {
  const checks = sourceChecks(draft, ctx.seen);
  const figures = draft.figures;
  const readable = figures.every((figure) => !ctx.unread?.has(figure.symbol));
  if (draft.type === 'metric' && figures.length > 0 && ctx.reaction && readable) {
    checks.push(result('numbers_match', numberFailures(draft.text, figures, ctx.reaction)));
  }
  const advice = containsAdvice(draft.text);
  checks.push(result('no_advice', advice ? [`buy, sell or hold language: "${advice}"`] : []));
  return checks;
}

// A metric with figures cites the market data next to what the model cited.
function claimSources(draft: DraftClaim, ctx: CheckContext) {
  const cited = draft.sources.map((s) => ({ sourceId: s.sourceId, quote: s.quote ?? null }));
  const figures = draft.figures;
  if (draft.type !== 'metric' || figures.length === 0 || ctx.marketSourceId === null) return cited;
  return [...cited, { sourceId: ctx.marketSourceId, quote: null }];
}

// The claims code wrote (core.ts) come first, then the model's, and every one goes through the
// same checks. A model inference may name a code claim as its premise by key.
export function checkDraft(
  draft: ReportDraft,
  ctx: CheckContext,
  codeClaims: readonly DraftClaim[] = [],
): CheckedDraft {
  const all = [
    ...codeClaims.map((c) => ({ ...c, origin: 'code' as const })),
    ...draft.claims.map((c) => ({ ...c, origin: 'model' as const })),
  ];
  const idOf = new Map(all.map((c) => [c.key, ctx.newId()]));
  const dropped: CheckedDraft['dropped'] = [];
  const built = new Map<string, Claim>();
  const unknownPremises = new Map<string, string[]>();

  for (const draftClaim of all) {
    const checks = claimChecks(draftClaim, ctx);
    const known = draftClaim.premises.filter((k) => k !== draftClaim.key && idOf.has(k));
    if (draftClaim.type === 'inference') {
      const unknown = draftClaim.premises.filter((k) => !known.includes(k));
      if (unknown.length > 0) unknownPremises.set(draftClaim.key, unknown);
    }
    const candidate = Claim.safeParse({
      _id: idOf.get(draftClaim.key),
      reportId: ctx.reportId,
      origin: draftClaim.origin,
      type: draftClaim.type,
      text: draftClaim.text,
      status: checks.every((c) => c.passed) ? 'unverified' : 'removed',
      checks,
      sources: claimSources(draftClaim, ctx),
      // Only an inference has premises, and only a metric has figures; the flat draft lets the
      // model send them on any type.
      premises: draftClaim.type === 'inference' ? known.map((k) => idOf.get(k)) : [],
      ...(draftClaim.type === 'metric' ? { figures: draftClaim.figures } : {}),
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
  const draftByKey = new Map(all.map((c) => [c.key, c]));
  const premisesOf = (key: string) =>
    (draftByKey.get(key)?.premises ?? []).filter((k) => idOf.has(k));
  for (let changed = true; changed;) {
    changed = false;
    for (const [key, claim] of built) {
      if (claim.type !== 'inference' || premiseFailures.has(key)) continue;
      const fallen = premisesOf(key).filter((k) => {
        const premise = built.get(k);
        return !premise || premise.status === 'removed' || premiseFailures.has(k);
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

  // Every inference must rest, through its premises, on facts and metrics. One that never does
  // is in a premise cycle or built on one.
  const grounded = new Set(
    [...built].filter(([, claim]) => claim.type !== 'inference').map(([key]) => key),
  );
  for (let changed = true; changed;) {
    changed = false;
    for (const [key, claim] of built) {
      if (claim.type !== 'inference' || grounded.has(key) || premiseFailures.has(key)) continue;
      if (premisesOf(key).every((k) => grounded.has(k))) {
        grounded.add(key);
        changed = true;
      }
    }
  }
  for (const [key, claim] of built) {
    if (claim.type !== 'inference' || grounded.has(key) || premiseFailures.has(key)) continue;
    const loose = premisesOf(key).filter((k) => !grounded.has(k));
    premiseFailures.set(key, [`its premises never reach a fact or a metric: ${loose.join(', ')}`]);
  }

  const removedBy = Object.fromEntries(
    DETERMINISTIC_CHECKS.map((name) => [name, [] as string[]]),
  ) as Record<DeterministicCheck, string[]>;
  const claims = [...built.entries()].map(([key, claim]) => {
    const failures = premiseFailures.get(key);
    const checks = failures
      ? [...claim.checks, result('premises_supported', failures)]
      : claim.checks;
    for (const check of checks) {
      if (!check.passed && check.name in removedBy) {
        removedBy[check.name as DeterministicCheck].push(claim._id);
      }
    }
    const status: Claim['status'] = checks.every((c) => c.passed) ? claim.status : 'removed';
    return { ...claim, checks, status };
  });

  const openQuestions = draft.openQuestions.filter((q) => containsAdvice(q) === null);
  const droppedQuestions = draft.openQuestions.filter((q) => containsAdvice(q) !== null);

  return {
    claims,
    keys: new Map([...built.entries()].map(([key, claim]) => [claim._id, key])),
    dropped,
    removedBy,
    openQuestions,
    droppedQuestions,
  };
}
