import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { FINANCIAL_CONCEPTS } from '@kesher/mcp';
import { UniverseSymbol } from '@kesher/shared';
import { z } from 'zod';
import { loadSecEnv } from '../config/env';
import { FILERS } from '../graph/filers';
import { secFetcher } from './fetch';
import { recordingPath, secConcepts } from './xbrl';

// npm run record:xbrl -- --symbols NVDA,AMD [--force]
// Records SEC companyconcept answers for every concept get_financial_facts reads, for each 10-K
// filer given, to recordings/sec-xbrl/<SYMBOL>/<concept>.json (committed; SEC data is public).
// Only the values SEC assigns to a calendar period (with a frame) are kept, the only ones the
// tool reads, so the files stay small; a concept the filer does not report is recorded as null.
// Tests replay them and never call SEC. Run by hand; needs SEC_USER_AGENT.

const Args = z.object({
  symbols: z
    .string()
    .transform((list) => list.split(',').map((symbol) => symbol.trim()))
    .pipe(z.array(UniverseSymbol).min(1)),
  force: z.boolean().default(false),
});
const { values } = parseArgs({
  options: { symbols: { type: 'string' }, force: { type: 'boolean' } },
});
const args = Args.safeParse(values);
if (!args.success) {
  console.error('Usage: npm run record:xbrl -- --symbols <T1,T2> [--force]');
  process.exit(1);
}
const { symbols, force } = args.data;
const foreign = symbols.filter((s) => FILERS.find((f) => f.symbol === s)?.form !== '10-K');
if (foreign.length > 0) {
  console.error(`Not us-gaap 10-K filers: ${foreign.join(', ')}.`);
  process.exit(1);
}

const get = secFetcher(loadSecEnv().SEC_USER_AGENT);
const read = secConcepts(() => get);

// The answer with only framed values, pretty printed like the other recordings.
function trimmed(json: string): string {
  const raw = JSON.parse(json) as { units?: Record<string, { frame?: string }[]> } & object;
  const units = Object.fromEntries(
    Object.entries(raw.units ?? {}).map(([unit, facts]) => [
      unit,
      facts.filter((fact) => fact.frame !== undefined),
    ]),
  );
  return `${JSON.stringify({ ...raw, units }, null, 2)}\n`;
}

let written = 0;
let kept = 0;
for (const symbol of symbols) {
  for (const concept of FINANCIAL_CONCEPTS) {
    const file = recordingPath(symbol, concept);
    if (existsSync(file) && !force) {
      kept++;
      continue;
    }
    const json = await read(symbol, concept);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, json === null ? 'null\n' : trimmed(json));
    written++;
    console.log(`${symbol} ${concept}: ${json === null ? 'not reported' : 'recorded'}`);
  }
}
console.log(`Wrote ${written} recording(s); kept ${kept} (pass --force to record them again).`);
