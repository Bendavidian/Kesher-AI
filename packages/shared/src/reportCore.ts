import { BENCHMARKS } from './domain/universe';
import type { MetricFigure } from './domain/research';
import type { FeedEvidence } from './feed';
import { REACTION_BENCHMARKS, type PriceReaction, type PriceSymbol } from './price';
import type { RelationshipType } from './domain/graph';
import { SHORT_NAME } from './whyYou';

// The deterministic report core (SPEC.md decision log, T20). Code writes these claims in every
// report, from fixed templates over the path's reviewed evidence and the price reaction, never by
// a model. They then go through the same checks and the verifier as the model's claims.

// Claim keys that only code uses: one path fact per hop, and the price metric. The model's own
// keys are c1 to c99, so a model inference can name a code claim as its premise.
export const PATH_FACT_KEYS = ['e1', 'e2'] as const;
export const PRICE_METRIC_KEY = 'm1';
export const CODE_CLAIM_KEYS = [...PATH_FACT_KEYS, PRICE_METRIC_KEY] as const;
export type CodeClaimKey = (typeof CODE_CLAIM_KEYS)[number];

// The verb of a code fact, read from the hop's from company to its to company. Not HOP_VERB: its
// "buys from" is buy language that no_advice removes, and a claim is held to that rule.
export const FACT_VERB: Record<RelationshipType, string> = {
  supplier_of: 'supplies',
  customer_of: 'is a customer of',
  competitor_of: 'competes with',
};

// "TSMC supplies NVIDIA, according to NVIDIA's 10-K." The claim quotes the edge's reviewed
// evidence; the sentence only names the hop and the filing.
export function pathFactText(evidence: Pick<FeedEvidence, 'from' | 'to' | 'type' | 'filing'>) {
  const { from, to, type, filing } = evidence;
  return `${SHORT_NAME[from]} ${FACT_VERB[type]} ${SHORT_NAME[to]}, according to ${SHORT_NAME[filing.symbol]}'s ${filing.form}.`;
}

export type PriceMetric =
  | { ok: true; text: string; figures: MetricFigure[] }
  | { ok: false; reason: 'not_ready' | 'unavailable' };

const MINUS = '−';

// −1.00%, +0.40%, 0.00%: a true minus, 2 decimals, the precision of the reaction.
function signed(pct: number): string {
  const sign = pct < 0 ? MINUS : pct > 0 ? '+' : '';
  return `${sign}${Math.abs(pct).toFixed(2)}%`;
}

function subjectClause(symbol: PriceSymbol, pct: number, anchor: PriceReaction['anchor']['kind']) {
  if (anchor === 'headline')
    return `${symbol} moved ${signed(pct)} in the 15 minutes after the headline`;
  if (pct === 0) return `${symbol} opened at its previous close, ${signed(pct)}`;
  return `${symbol} opened ${signed(pct)} ${pct < 0 ? 'below' : 'above'} its previous close`;
}

// The price metric: the subjects' move in the reaction's first window (the open gap after a
// headline outside the session, 15 minutes after a headline inside it), then SMH and SPY in the
// same window. Timing only, never a cause (principle 7). Its figures are exactly the numbers in
// the text, so numbers_match checks each one.
export function priceMetricFor(
  reaction: PriceReaction,
  subjects: readonly PriceSymbol[],
): PriceMetric {
  const benchmarks: readonly PriceSymbol[] = BENCHMARKS;
  const stocks = [...new Set(subjects)].filter((symbol) => !benchmarks.includes(symbol));
  const window = reaction.windows[0];
  if (!window || stocks.length === 0) return { ok: false, reason: 'unavailable' };

  const figures: MetricFigure[] = [];
  for (const symbol of [...stocks, ...REACTION_BENCHMARKS]) {
    const row = reaction.rows.find((r) => r.symbol === symbol);
    if (!row) return { ok: false, reason: 'unavailable' };
    const pct = row.moves[0]?.pct ?? null;
    if (pct === null) return { ok: false, reason: 'not_ready' };
    figures.push({ symbol, window: window.name, pct });
  }

  const anchor = reaction.anchor.kind;
  const clauses = figures
    .slice(0, stocks.length)
    .map((figure) => subjectClause(figure.symbol, figure.pct, anchor));
  const marks = figures
    .slice(stocks.length)
    .map((figure) => `${figure.symbol} ${signed(figure.pct)}`);
  return { ok: true, text: `${clauses.join(' and ')}; ${marks.join(', ')}.`, figures };
}
