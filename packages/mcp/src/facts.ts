import { Id, UniverseSymbol, type Source } from '@kesher/shared';
import type { Collection } from 'mongodb';
import { z } from 'zod';
import { fitItems } from './fit';
import { nameUuid, sourceIdName } from './sourceIds';
import type { ToolDefinition } from './tools';

// get_financial_facts: reported XBRL values from SEC EDGAR (us-gaap filers only in the MVP).
// The values are as filed, with their period and filing; the tool computes nothing from them.

// A short list of metrics, each a us-gaap concept or the concepts filers use for it, in order.
export const FINANCIAL_METRICS = {
  revenue: ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'SalesRevenueNet'],
  gross_profit: ['GrossProfit'],
  operating_income: ['OperatingIncomeLoss'],
  net_income: ['NetIncomeLoss'],
  eps_diluted: ['EarningsPerShareDiluted'],
  rnd_expense: ['ResearchAndDevelopmentExpense'],
  cash: ['CashAndCashEquivalentsAtCarryingValue'],
  inventory: ['InventoryNet'],
} as const satisfies Record<string, readonly string[]>;
export type FinancialMetric = keyof typeof FINANCIAL_METRICS;
export const FinancialMetric = z.enum(
  Object.keys(FINANCIAL_METRICS) as [FinancialMetric, ...FinancialMetric[]],
);
export const FINANCIAL_CONCEPTS = [...new Set(Object.values(FINANCIAL_METRICS).flat())];

export const ANNUAL_VALUES = 3;
export const QUARTERLY_VALUES = 4;

// One reported value, as SEC's companyconcept API gives it. frame is set on the value SEC
// assigns to a calendar period (CY2024, CY2024Q3, CY2024Q3I for a balance on a date), the last
// filed one; other values repeat it in later filings.
export interface XbrlFact {
  start: string | null;
  end: string;
  val: number;
  accn: string;
  fy: number | null;
  fp: string | null;
  form: string;
  filed: string;
  frame: string | null;
}

export interface ConceptFacts {
  cik: string;
  concept: string;
  // Keyed by unit, for example USD or USD/shares.
  units: Record<string, XbrlFact[]>;
}

// null when the filer does not report the concept (SEC answers 404).
export type CompanyConceptSource = (
  symbol: UniverseSymbol,
  concept: string,
) => Promise<ConceptFacts | null>;

const GetFinancialFactsInput = z.strictObject({
  symbol: UniverseSymbol.describe('A demo universe company that files a 10-K'),
  metrics: z
    .array(FinancialMetric)
    .min(1)
    .max(4)
    .refine((metrics) => new Set(metrics).size === metrics.length, { error: 'each metric once' })
    .describe('Up to 4 metrics'),
});

const IsoDate = z.iso.date();

const Value = z.strictObject({
  // null for a balance on a date, such as cash.
  start: IsoDate.nullable(),
  end: IsoDate,
  value: z.number(),
  fy: z.int().nullable(),
  fp: z.string().nullable(),
  form: z.string(),
  filed: IsoDate,
  accn: z.string(),
  // The filing Source a metric claim about this value cites.
  sourceId: Id,
});
type Value = z.output<typeof Value>;

const MetricFacts = z.strictObject({
  metric: FinancialMetric,
  // null when the filer reports none of the metric's concepts.
  concept: z.string().nullable(),
  unit: z.string().nullable(),
  // Newest first: full fiscal years, then quarters (or quarter end balances).
  annual: z.array(Value).max(ANNUAL_VALUES),
  quarterly: z.array(Value).max(QUARTERLY_VALUES),
});
type MetricFacts = z.output<typeof MetricFacts>;

const Filing = z.strictObject({
  sourceId: Id,
  accn: z.string(),
  form: z.string(),
  filed: IsoDate,
  url: z.string(),
  title: z.string(),
});
type Filing = z.output<typeof Filing>;

export const GetFinancialFactsOutput = z.strictObject({
  symbol: UniverseSymbol,
  metrics: z.array(MetricFacts),
  // The filings the values come from, one each.
  filings: z.array(Filing),
  // Metrics left out to keep the output within 8 KB.
  omitted: z.int().min(0),
});
export type GetFinancialFactsOutput = z.output<typeof GetFinancialFactsOutput>;

const ANNUAL = /^CY\d{4}$/;
const QUARTERLY = /^CY\d{4}Q[1-4]I?$/;

const newest = (facts: XbrlFact[], frame: RegExp, count: number) =>
  facts
    .filter((fact) => fact.frame !== null && frame.test(fact.frame))
    .sort((a, b) => b.end.localeCompare(a.end) || b.filed.localeCompare(a.filed))
    .slice(0, count);

export interface Selected {
  concept: string;
  unit: string;
  annual: XbrlFact[];
  quarterly: XbrlFact[];
}

// Of the concepts a filer reports for a metric, the one with the newest period, since filers
// switch concepts over the years (Revenues and RevenueFromContractWithCustomer...). Within it,
// the first unit that has calendar period values. Pure; equal inputs give equal output.
export function selectFacts(found: readonly ConceptFacts[]): Selected | null {
  let best: Selected | null = null;
  for (const facts of found) {
    for (const [unit, values] of Object.entries(facts.units)) {
      const annual = newest(values, ANNUAL, ANNUAL_VALUES);
      const quarterly = newest(values, QUARTERLY, QUARTERLY_VALUES);
      const latest = [...annual, ...quarterly]
        .map((v) => v.end)
        .sort()
        .at(-1);
      if (!latest) continue;
      const bestLatest =
        best &&
        [...best.annual, ...best.quarterly]
          .map((v) => v.end)
          .sort()
          .at(-1);
      if (!bestLatest || latest > bestLatest) {
        best = { concept: facts.concept, unit, annual, quarterly };
      }
      break;
    }
  }
  return best;
}

const filingUrl = (cik: string, accn: string) =>
  `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accn.replaceAll('-', '')}/`;

async function filingIds(
  sources: Collection<Source>,
  accns: readonly string[],
): Promise<Map<string, string>> {
  const stored = await sources
    .find(
      { provider: 'sec_edgar', externalId: { $in: [...accns] } },
      { projection: { _id: 1, externalId: 1 } },
    )
    .toArray();
  const ids = new Map(stored.map((s) => [s.externalId, s._id]));
  for (const accn of accns) {
    if (!ids.has(accn)) ids.set(accn, nameUuid(sourceIdName('sec_edgar', accn)));
  }
  return ids;
}

export const getFinancialFacts: ToolDefinition<
  typeof GetFinancialFactsInput,
  typeof GetFinancialFactsOutput
> = {
  name: 'get_financial_facts',
  description:
    'Reported XBRL values of a US filer from SEC EDGAR for up to 4 metrics: the last 3 fiscal years and the last 4 quarters, each with its period, filing and source id. Values are as filed.',
  inputSchema: GetFinancialFactsInput,
  outputSchema: GetFinancialFactsOutput,
  async run({ symbol, metrics }, { companies, sources, companyConcept }) {
    const company = await companies.findOne({ symbol }, { projection: { filerType: 1, name: 1 } });
    if (company?.filerType === '20-F') {
      return { ok: false, error: `${symbol} files a 20-F; XBRL facts cover us-gaap filers only` };
    }

    const chosen: { metric: FinancialMetric; selected: Selected | null; cik: string | null }[] = [];
    try {
      for (const metric of metrics) {
        const found: ConceptFacts[] = [];
        for (const concept of FINANCIAL_METRICS[metric]) {
          const facts = await companyConcept(symbol, concept);
          if (facts) found.push(facts);
        }
        chosen.push({ metric, selected: selectFacts(found), cik: found[0]?.cik ?? null });
      }
    } catch {
      // The api logs the cause where it passes the source in.
      return { ok: false, error: 'SEC data is unavailable' };
    }
    if (chosen.every((c) => c.selected === null)) {
      return { ok: false, error: `No XBRL facts for ${symbol} on these metrics` };
    }

    const facts = chosen.flatMap((c) =>
      c.selected ? [...c.selected.annual, ...c.selected.quarterly] : [],
    );
    const ids = await filingIds(sources, [...new Set(facts.map((f) => f.accn))]);
    const cik = chosen.find((c) => c.cik)?.cik ?? '0';
    const value = (fact: XbrlFact): Value => ({
      start: fact.start,
      end: fact.end,
      value: fact.val,
      fy: fact.fy,
      fp: fact.fp,
      form: fact.form,
      filed: fact.filed,
      accn: fact.accn,
      sourceId: ids.get(fact.accn)!,
    });
    const out: MetricFacts[] = chosen.map(({ metric, selected }) => ({
      metric,
      concept: selected?.concept ?? null,
      unit: selected?.unit ?? null,
      annual: selected?.annual.map(value) ?? [],
      quarterly: selected?.quarterly.map(value) ?? [],
    }));
    const filingsOf = (kept: MetricFacts[]): Filing[] => {
      const byAccn = new Map<string, Value>();
      for (const v of kept.flatMap((m) => [...m.annual, ...m.quarterly])) {
        if (!byAccn.has(v.accn)) byAccn.set(v.accn, v);
      }
      return [...byAccn.values()]
        .sort((a, b) => b.filed.localeCompare(a.filed) || a.accn.localeCompare(b.accn))
        .map((v) => ({
          sourceId: v.sourceId,
          accn: v.accn,
          form: v.form,
          filed: v.filed,
          url: filingUrl(cik, v.accn),
          title: `${company?.name ?? symbol} ${v.form} filed ${v.filed}`,
        }));
    };
    const output: GetFinancialFactsOutput = fitItems(out, (kept, omitted) => ({
      symbol,
      metrics: kept,
      filings: filingsOf(kept),
      omitted,
    }));
    return { ok: true, output };
  },
};
