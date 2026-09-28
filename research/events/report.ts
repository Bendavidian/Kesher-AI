// docs/research/eval-candidates.md from candidates.ts. Every item is fetched again from Alpaca
// by source id, so id, created_at, headline and symbols in the table come from the API.
// Run: npx tsx research/events/report.ts
// Fails when an id is not found at its created_at, the demo item is not first, or an item has
// no demo universe symbol (the pre-filter would drop it).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { byId, ROOT, type NewsItem } from './alpaca';
import { CANDIDATES, PERSONAS, type EventType, type Label, type Level } from './candidates';

const DEMO_SOURCE_ID = 38062166;
const UNIVERSE = new Set(
  'NVDA MSFT AMZN GOOGL META AMD AVGO INTC QCOM MU TSM ASML AMAT LRCX KO JNJ XOM'.split(' '),
);
const TYPES: EventType[] = [
  'earnings',
  'guidance',
  'production_disruption',
  'regulation',
  'analyst_action',
  'merger',
];
const LEVELS: Level[] = ['high', 'medium', 'none'];

const problems: string[] = [];
if (CANDIDATES[0]?.id !== DEMO_SOURCE_ID)
  problems.push(`the first candidate is not ${DEMO_SOURCE_ID}`);
if (new Set(CANDIDATES.map((c) => c.id)).size !== CANDIDATES.length) problems.push('duplicate ids');

const items = new Map<number, NewsItem>();
for (const c of CANDIDATES) {
  const item = await byId(c.id, c.updatedAt);
  if (!item) {
    problems.push(`${c.id}: not found at updated_at ${c.updatedAt}`);
    continue;
  }
  if (!item.symbols.some((s) => UNIVERSE.has(s))) problems.push(`${c.id}: no universe symbol`);
  if (item.created_at !== c.createdAt) problems.push(`${c.id}: created_at is ${item.created_at}`);
  items.set(c.id, item);
}
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}

// The demo item first, then by event type and time.
const rows = [
  CANDIDATES[0]!,
  ...CANDIDATES.slice(1).sort(
    (a, b) =>
      TYPES.indexOf(a.type) - TYPES.indexOf(b.type) || a.createdAt.localeCompare(b.createdAt),
  ),
];

const cell = (s: string) => s.replace(/\|/g, '\\|');
const label = (l: Label) => `${l.level} (proposed): ${cell(l.reason)}`;
const universeFirst = (symbols: string[]) =>
  [...symbols.filter((s) => UNIVERSE.has(s)), ...symbols.filter((s) => !UNIVERSE.has(s))]
    .map((s) => (UNIVERSE.has(s) ? `**${s}**` : s))
    .join(', ');

const table = rows
  .map((c, i) => {
    const item = items.get(c.id)!;
    return `| ${i + 1} | ${item.id} | ${item.created_at} | ${cell(item.headline)} | ${universeFirst(item.symbols)} | ${c.type} | ${label(c.A)} | ${label(c.B)} | ${label(c.C)} |`;
  })
  .join('\n');

const notes = rows
  .map((c, i) => (c.note ? `- #${i + 1}, ${c.id}: ${c.note}` : ''))
  .filter(Boolean)
  .join('\n');

// Items edited well after publication: a created_at window would miss them.
const late = rows
  .map((c) => items.get(c.id)!)
  .filter((n) => Date.parse(n.updated_at) - Date.parse(n.created_at) > 60_000)
  .map((n) => `${n.id} (created ${n.created_at}, updated ${n.updated_at})`);

const countType = (t: EventType) => CANDIDATES.filter((c) => c.type === t).length;
const countLevel = (p: 'A' | 'B' | 'C', l: Level) =>
  CANDIDATES.filter((c) => c[p].level === l).length;
const onlyC = CANDIDATES.filter((c) => c.A.level === 'none' && c.B.level === 'none').length;

const out = `# Eval event candidates for T16

Background research, not a backlog task. ${CANDIDATES.length} real news items from 2024 to 2026, found through the Alpaca news REST API (no WebSocket) with \`research/events/search.ts\` and listed in \`research/events/candidates.ts\`. \`npx tsx research/events/report.ts\` fetches every item again by source id and writes this file, so id, time, headline and symbols are exactly what Alpaca returns; bold symbols are in the demo universe.

**Every label is proposed and unreviewed.** Labels follow the relevance rule in SPEC.md ("Scores"): the best path from an event company to a holding. A holding scores 1, one hop scores the edge weight (supplier or customer 0.8, competitor 0.6, same sector 0.4, shared theme 0.3), and two hops multiply both weights by 0.7. Supplier, customer and competitor edges are the evidence candidates in \`docs/research/edge-candidates.md\`, used in both directions. Proposed mapping: **high** at 0.8 or more (a holding, or one supplier or customer hop), **medium** from 0.4 to below 0.8, **none** below 0.4.

Personas: A, ${PERSONAS.A}. B, ${PERSONAS.B}. C, ${PERSONAS.C}.

## Coverage

| Event type | Items |
|---|---|
${TYPES.map((t) => `| ${t} | ${countType(t)} |`).join('\n')}

| Persona | high | medium | none |
|---|---|---|---|
${(['A', 'B', 'C'] as const).map((p) => `| ${p} | ${LEVELS.map((l) => countLevel(p, l)).join(' | ')} |`).join('\n')}

${onlyC} items reach only persona C (KO, JNJ or XOM news that must not reach A or B).

## Candidates

| # | Source id | created_at | Headline | Symbols | Type | A (NVDA, MSFT, AMZN) | B (AMD, AVGO, TSM, ASML) | C (KO, JNJ, XOM) |
|---|---|---|---|---|---|---|---|---|
${table}

## Notes

${notes}

## Points to review

- B is high on every NVDA item through \`NVDA customer_of TSM\` at 0.8, the inverse of the supplier edge. SPEC.md wants NVDA news to reach TSM holders; whether a routine NVDA rating change should be high for them is a weight question for T16.
- The ASML items are medium for A only if T11 puts ASML and NVDA in the same sector from the Finnhub profiles. Without that edge the best path is ASML→INTC→NVDA at 0.34, which is none.
- Items that tag several universe companies (the Blackwell delay, the Qualcomm approach, the NVIDIA investment in Intel) were labeled from every tagged company; extraction may find fewer, which changes the path.
- B is bimodal under this rule: NVDA, INTC and QCOM are TSM customers, so their news is high for B, and AI and cloud news is none. Only the Micron item is medium (two supply hops).
- MSFT, AMZN and GOOGL items do not reach B: the only paths run through a competitor edge and then a customer edge (0.34).
- Replay lookup: Alpaca applies \`start\` and \`end\` to \`updated_at\`, not \`created_at\`, and has no id filter. ${late.length} of these items were updated more than a minute after publication and are invisible in a window around their created_at: ${late.join('; ')}. \`research/events/candidates.ts\` stores updated_at for every item, and replay by source id needs it too.
`;

mkdirSync(join(ROOT, 'docs', 'research'), { recursive: true });
writeFileSync(join(ROOT, 'docs', 'research', 'eval-candidates.md'), out);
console.log(`${CANDIDATES.length} candidates written, all found by source id`);
