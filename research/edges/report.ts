// Step 3: docs/research/edge-candidates.md from the cached candidates and review.ts.
// Run: npx tsx research/edges/report.ts (after find.ts; no network).
// Fails when a candidate is unreviewed, an edge names a company the sentence does not name, a
// quote is not verbatim in the filing text, or an accepted edge has no single picked quote.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { REVIEW, type Edge, type EdgeType } from './review';
import { CACHE, ROOT } from './sec';
import { flatText } from './text';
import { UNIVERSE, company, type Ticker } from './universe';

const TickerSchema = z.enum(UNIVERSE.map((c) => c.symbol) as [Ticker, ...Ticker[]]);
const FilingRow = z.object({
  symbol: TickerSchema,
  filer: z.string(),
  accession: z.string(),
  filingDate: z.string(),
  reportDate: z.string(),
  url: z.string(),
});
const CandidateRow = z.object({
  id: z.string(),
  filer: TickerSchema,
  accession: z.string(),
  section: z.enum(['Item 1', 'Item 1A']),
  sentence: z.string(),
  mentions: z.array(z.object({ symbol: TickerSchema, alias: z.string() })),
});
type Candidate = z.infer<typeof CandidateRow>;

const readRows = <T>(file: string, schema: z.ZodType<T>): T[] =>
  readFileSync(join(CACHE, file), 'utf8')
    .trim()
    .split('\n')
    .map((line) => schema.parse(JSON.parse(line)));

const filings = readRows('filings.ndjson', FilingRow);
const filingOf = new Map(filings.map((f) => [f.accession, f]));
const texts = new Map(
  filings.map((f) => [
    f.accession,
    flatText(readFileSync(join(CACHE, `${f.accession}.html.raw`), 'utf8')),
  ]),
);

// The same sentence can appear twice in a filing; it is one candidate.
const candidates = [
  ...new Map(readRows('candidates.ndjson', CandidateRow).map((c) => [c.id, c])).values(),
];

const problems: string[] = [];
for (const id of Object.keys(REVIEW)) {
  if (!candidates.some((c) => c.id === id)) problems.push(`${id}: reviewed but not a candidate`);
}

interface Row {
  edge: Edge;
  candidate: Candidate;
  quote: string;
}
const accepted: Row[] = [];
const borderline: Row[] = [];
const rejected: { candidate: Candidate; reason: string }[] = [];

for (const c of candidates) {
  const d = REVIEW[c.id];
  if (!d) {
    problems.push(`${c.id}: not reviewed (${c.filer}) ${c.sentence.slice(0, 80)}`);
    continue;
  }
  if ([d.accept, d.borderline, d.reject].filter(Boolean).length !== 1) {
    problems.push(`${c.id}: needs exactly one of accept, borderline, reject`);
  }
  const quote = d.quote ?? c.sentence;
  if (!quote.includes(c.sentence) || !texts.get(c.accession)?.includes(quote)) {
    problems.push(`${c.id}: quote is not verbatim in ${c.accession}`);
  }
  const named = new Set<Ticker>(c.mentions.map((m) => m.symbol));
  for (const edge of [...(d.accept ?? []), ...(d.borderline ?? [])]) {
    const other = edge.from === c.filer ? edge.to : edge.to === c.filer ? edge.from : undefined;
    if (!other || !named.has(other)) {
      problems.push(
        `${c.id}: ${edge.from} ${edge.type} ${edge.to} is not the filer and a named company`,
      );
    }
  }
  for (const edge of d.accept ?? []) accepted.push({ edge, candidate: c, quote });
  for (const edge of d.borderline ?? []) borderline.push({ edge, candidate: c, quote });
  if (d.reject) rejected.push({ candidate: c, reason: d.reject });
}

const key = (e: Edge) => `${e.from} ${e.type} ${e.to}`;
const edges = new Map<string, Row[]>();
for (const row of accepted) edges.set(key(row.edge), [...(edges.get(key(row.edge)) ?? []), row]);
for (const [k, rows] of edges) {
  const picks = rows.filter((r) => r.edge.pick).length;
  if (picks !== 1) problems.push(`${k}: ${picks} picked quotes, expected 1`);
}

if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}

// Markdown

const TYPES: EdgeType[] = ['supplier_of', 'customer_of', 'competitor_of'];
const cell = (s: string) => s.replace(/\|/g, '\\|');
const docLink = (accession: string) => {
  const f = filingOf.get(accession);
  return f ? `[10-K](${f.url})` : '';
};
const order = (a: Row, b: Row) =>
  a.edge.from.localeCompare(b.edge.from) ||
  TYPES.indexOf(a.edge.type) - TYPES.indexOf(b.edge.type) ||
  a.edge.to.localeCompare(b.edge.to) ||
  Number(!a.edge.pick) - Number(!b.edge.pick);

const table = (rows: Row[], withPick: boolean) => {
  const head = withPick
    ? '| From | Type | To | Pick | Quote | Section | Accession | Filed | Document |\n|---|---|---|---|---|---|---|---|---|'
    : '| From | Type | To | Quote | Section | Accession | Filed | Document |\n|---|---|---|---|---|---|---|---|';
  const lines = [...rows].sort(order).map((r) => {
    const f = filingOf.get(r.candidate.accession);
    const cells = [
      r.edge.from,
      r.edge.type,
      r.edge.to,
      ...(withPick ? [r.edge.pick ? 'yes' : ''] : []),
      cell(r.quote),
      `${r.candidate.filer} ${r.candidate.section}`,
      r.candidate.accession,
      f?.filingDate ?? '',
      docLink(r.candidate.accession),
    ];
    return `| ${cells.join(' | ')} |`;
  });
  return [head, ...lines].join('\n');
};

// Pairs: every unordered pair of universe companies.
const pairKey = (a: Ticker, b: Ticker) => [a, b].sort().join('-');
const found = new Map<string, Set<EdgeType>>();
for (const row of accepted) {
  const k = pairKey(row.edge.from, row.edge.to);
  found.set(k, (found.get(k) ?? new Set()).add(row.edge.type));
}
const tech = UNIVERSE.filter((c) => c.group !== 'unrelated');
const unrelated = UNIVERSE.filter((c) => c.group === 'unrelated');
const allPairs = UNIVERSE.flatMap((a, i) => UNIVERSE.slice(i + 1).map((b) => [a, b] as const));
const missing = allPairs.filter(([a, b]) => !found.has(pairKey(a.symbol, b.symbol)));
const techMissing = missing.filter(([a, b]) => a.group !== 'unrelated' && b.group !== 'unrelated');

const letters = (types: Set<EdgeType> | undefined) =>
  types
    ? [
        types.has('supplier_of') || types.has('customer_of') ? 'S' : '',
        types.has('competitor_of') ? 'C' : '',
      ].join('')
    : '·';
const matrix = [
  `| | ${tech.map((c) => c.symbol).join(' | ')} |`,
  `|---|${tech.map(() => '---').join('|')}|`,
  ...tech.map(
    (a) =>
      `| **${a.symbol}** | ${tech
        .map((b) => (a === b ? '—' : letters(found.get(pairKey(a.symbol, b.symbol)))))
        .join(' | ')} |`,
  ),
].join('\n');

// Pairs that matter for the personas and the TSMC demo event, with what the filings show.
const IMPORTANT: [Ticker, Ticker, string][] = [
  ['NVDA', 'MSFT', 'GPU buyer (persona A holds both)'],
  ['NVDA', 'AMZN', 'GPU buyer (persona A holds both)'],
  ['NVDA', 'GOOGL', 'GPU buyer'],
  ['NVDA', 'META', 'GPU buyer'],
  ['AMD', 'MSFT', 'Instinct GPU and Xbox SoC buyer'],
  ['AMD', 'META', 'Instinct GPU buyer'],
  ['AVGO', 'GOOGL', 'custom accelerator (TPU) partner'],
  ['AVGO', 'META', 'custom accelerator partner'],
  ['TSM', 'NVDA', 'foundry for the demo event'],
  ['TSM', 'AMD', 'foundry (persona B holds both)'],
  ['TSM', 'AVGO', 'foundry (persona B holds both)'],
  ['TSM', 'ASML', 'EUV tools (persona B holds both)'],
  ['TSM', 'AMAT', 'equipment buyer'],
  ['TSM', 'LRCX', 'equipment buyer'],
  ['ASML', 'INTC', 'EUV tools'],
  ['ASML', 'MU', 'lithography tools'],
  ['AMAT', 'INTC', 'equipment buyer'],
  ['AMAT', 'MU', 'equipment buyer'],
  ['LRCX', 'INTC', 'equipment buyer'],
  ['MU', 'NVDA', 'HBM supplier'],
  ['NVDA', 'AMD', 'GPU competitors'],
  ['MSFT', 'AMZN', 'cloud competitors (persona A holds both)'],
  ['MSFT', 'GOOGL', 'cloud competitors'],
  ['AMZN', 'GOOGL', 'cloud competitors'],
  ['AMAT', 'LRCX', 'equipment competitors'],
];

const GAP_NOTES: Partial<Record<string, string>> = {
  'MSFT-NVDA':
    'NVIDIA names Microsoft only as a competitor and in the Xbox change of control agreement; its direct customers are anonymized. Microsoft names no universe company.',
  'AMZN-NVDA':
    'Competitor evidence only. NVIDIA does not name customers; Amazon names no universe company.',
  'GOOGL-NVDA': 'Competitor evidence only. Alphabet names no universe company as a partner.',
  'META-NVDA':
    'NVIDIA does not name Meta; Meta names only Google (as a platform and a competitor).',
  'AMD-MSFT':
    'Borderline only: Xbox consoles run on AMD semi-custom SoCs, with no supplier or customer word.',
  'AMD-META': 'Neither filing names the other.',
  'AVGO-GOOGL': 'Broadcom names no customer from the universe; Alphabet does not name Broadcom.',
  'AVGO-META': 'Broadcom names no customer from the universe; Meta does not name Broadcom.',
  'ASML-TSM': 'Both file a 20-F, which this research does not read.',
  'AMAT-TSM': "Applied Materials' Items 1 and 1A name no customer.",
  'ASML-MU': 'ASML files a 20-F; Micron names no supplier from the universe.',
  'AMAT-INTC': "Applied Materials' Items 1 and 1A name no customer; Intel does not name it.",
  'AMAT-MU':
    "Applied Materials' Items 1 and 1A name no customer; Micron names no universe company.",
  'INTC-LRCX':
    'Lam lists Micron, Samsung, SK hynix and TSMC as its most significant customers, not Intel.',
  'AMZN-MSFT': 'Neither 10-K names any universe company.',
  'GOOGL-MSFT': 'Microsoft names no universe company; Alphabet names LinkedIn only as a channel.',
  'AMZN-GOOGL': 'Neither 10-K names the other.',
};

// Competitor edges found from both sides are one relationship; supplier_of and customer_of are
// inverses of each other. A relationship is stored as two directed edges.
const relationship = (e: Edge) =>
  e.type === 'competitor_of'
    ? `competitor ${pairKey(e.from, e.to)}`
    : e.type === 'supplier_of'
      ? `supply ${e.from}>${e.to}`
      : `supply ${e.to}>${e.from}`;
const relationships = new Set(accepted.map((r) => relationship(r.edge)));

const count = (type: EdgeType) => [...edges.keys()].filter((k) => k.includes(` ${type} `)).length;
const hits = (type: EdgeType) => accepted.filter((r) => r.edge.type === type).length;
const byReason = new Map<string, number>();
for (const r of rejected) byReason.set(r.reason, (byReason.get(r.reason) ?? 0) + 1);

const out = `# Edge evidence candidates for T11

Background research, not a backlog task. Generated by \`research/edges\` from the latest 10-K of every US filer in the demo universe (SPEC.md, "Demo universe and personas"); TSM and ASML file 20-F and were not read. Items 1 and 1A only.

- Regenerate: \`npx tsx research/edges/find.ts\` (SEC, cached in \`research/edges/cache/\`), then \`npx tsx research/edges/report.ts\`.
- An edge reads **from type to**: \`TSM supplier_of NVDA\` means TSMC supplies NVIDIA, in the direction the sentence states. T11 creates the inverse edges.
- Every quote is verbatim in the filing text produced by \`htmlToText\` in \`spike/checks/01-sec.ts\`; \`report.ts\` checks it.
- A sentence counts only when it names the company (aliases in \`research/edges/universe.ts\`) and states the role. The decision on every candidate sentence is in \`research/edges/review.ts\`. All rows are unreviewed candidates for the T11 review CLI.
- **Pick** marks the quote proposed as the evidence of each edge; the other rows for the same edge are additional support.

## Summary

| Type | Edges | Evidence rows |
|---|---|---|
${TYPES.map((t) => `| ${t} | ${count(t)} | ${hits(t)} |`).join('\n')}
| **Total** | **${edges.size}** | **${accepted.length}** |

An evidence row is one edge supported by one sentence; a sentence that names several companies gives several rows. Competitor edges found from both sides (\`AMD competitor_of NVDA\` in NVIDIA's 10-K, \`NVDA competitor_of AMD\` in AMD's) describe one relationship, so the ${edges.size} edges are **${relationships.size} relationships**, which T11 stores as ${relationships.size * 2} directed edges with the inverses. T11 asks for at least 40 reviewed edges: met only when both directions count.

${candidates.length} candidate sentences named another universe company: ${new Set(accepted.map((r) => r.candidate.id)).size} accepted, ${new Set(borderline.map((r) => r.candidate.id)).size} borderline, ${rejected.length} rejected. ${allPairs.length - missing.length} of ${allPairs.length} universe pairs have evidence.

## Filings read

| Filer | Accession | Filed | Period | Document |
|---|---|---|---|---|
${filings.map((f) => `| ${f.symbol} | ${f.accession} | ${f.filingDate} | ${f.reportDate} | [10-K](${f.url}) |`).join('\n')}

MSFT, AMZN, MU, KO, JNJ and XOM name no other universe company anywhere in their 10-K, so every edge comes from NVDA, GOOGL, META, AMD, AVGO, INTC, QCOM, AMAT and LRCX. Intel's 10-K does not follow the Item order; its cross-reference index maps Item 1 to pages 3 to 24 ("Overview" through the operating segment results) and Item 1A to pages 37 to 51 ("Risk Factors").

## Edges

Sorted by from, type and to; the picked quote comes first.

${table(accepted, true)}

## Borderline, not counted

The company is named and a supply relationship is described, but the sentence has no supplier or customer word.

${table(borderline, false)}

## Rejected candidates

| Reason | Sentences |
|---|---|
${[...byReason].map(([reason, n]) => `| ${reason} | ${n} |`).join('\n')}

## Universe pairs with no evidence

${missing.length} of ${allPairs.length} pairs. The matrix covers every pair outside the unrelated group: S marks a supplier or customer edge in either direction, C a competitor edge, and · no evidence.

${matrix}

**Semiconductor, equipment, AI and cloud companies** (${techMissing.length} of ${(tech.length * (tech.length - 1)) / 2} pairs), each pair listed once under the company that comes first in the universe order:

| Company | No evidence with |
|---|---|
${tech
  .map((a) => [a, techMissing.filter(([x]) => x === a).map(([, b]) => b.symbol)] as const)
  .filter(([, list]) => list.length > 0)
  .map(([a, list]) => `| ${a.symbol} | ${list.join(', ')} |`)
  .join('\n')}

**Unrelated companies**: ${unrelated.map((c) => c.symbol).join(', ')} have no evidence with any universe company (${missing.length - techMissing.length} pairs). This is expected: persona C must stay unconnected.

### Important pairs

| Pair | Why it matters | Evidence | Note |
|---|---|---|---|
${IMPORTANT.map(([a, b, why]) => {
  const types = found.get(pairKey(a, b));
  const note = GAP_NOTES[pairKey(a, b)] ?? '';
  return `| ${company(a).symbol}–${company(b).symbol} | ${why} | ${types ? [...types].join(', ') : '**none**'} | ${note} |`;
}).join('\n')}
`;

mkdirSync(join(ROOT, 'docs', 'research'), { recursive: true });
writeFileSync(join(ROOT, 'docs', 'research', 'edge-candidates.md'), out);
console.log(
  `${edges.size} edges (${TYPES.map((t) => `${t} ${count(t)}`).join(', ')}), ` +
    `${relationships.size} relationships, ${accepted.length} evidence rows, ${missing.length} pairs without evidence`,
);
