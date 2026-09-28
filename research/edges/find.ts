// Step 1: candidate sentences. For every US filer in the universe, fetch the latest 10-K, take
// Item 1 and Item 1A, and keep each sentence that names another universe company.
// Run: npx tsx research/edges/find.ts
// Writes cache/filings.ndjson and cache/candidates.ndjson; report.ts turns them into the table.
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CACHE, document, latest10K, type Filing } from './sec';
import { blocks, flatText, sections, sentences } from './text';
import { mentions, UNIVERSE, type Mention, type Ticker } from './universe';

export interface FiledBy extends Filing {
  symbol: Ticker;
}

export interface Candidate {
  id: string;
  filer: Ticker;
  accession: string;
  section: 'Item 1' | 'Item 1A';
  sentence: string;
  mentions: Mention[];
  // Keywords that suggest a relationship type. A hint only: every edge is decided in review.ts.
  hints: string[];
  verbatim: boolean;
}

const HINTS: [string, RegExp][] = [
  ['competitor', /compet|rival/i],
  ['supplier', /suppl|vendor|foundr|manufactur|fabricat|sourc|procure|third-party/i],
  ['customer', /customer|client|sales to|sell|revenue|accounted for|purchas/i],
];

const filings: FiledBy[] = [];
const candidates: Candidate[] = [];

for (const c of UNIVERSE.filter((u) => u.form === '10-K')) {
  const filing = await latest10K(c.cik);
  const { html, cached } = await document(filing);
  filings.push({ symbol: c.symbol, ...filing });

  const flat = flatText(html);
  const { item1, item1a } = sections(blocks(html), c.layout);
  let found = 0;
  for (const [section, list] of [
    ['Item 1', item1],
    ['Item 1A', item1a],
  ] as const) {
    for (const sentence of sentences(list)) {
      const named = mentions(sentence).filter((m) => m.symbol !== c.symbol);
      if (named.length === 0) continue;
      found++;
      candidates.push({
        id: createHash('sha1')
          .update(`${filing.accession}\n${sentence}`)
          .digest('hex')
          .slice(0, 10),
        filer: c.symbol,
        accession: filing.accession,
        section,
        sentence,
        mentions: named,
        hints: HINTS.filter(([, p]) => p.test(sentence)).map(([h]) => h),
        verbatim: flat.includes(sentence),
      });
    }
  }
  const chars = (list: string[]) => list.reduce((n, b) => n + b.length, 0);
  console.log(
    `${c.symbol.padEnd(5)} ${filing.accession} filed ${filing.filingDate}${cached ? ' (cache)' : ''}` +
      `  item1 ${chars(item1)} chars, item1a ${chars(item1a)} chars, ${found} candidates`,
  );
}

const ndjson = (rows: unknown[]) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
writeFileSync(join(CACHE, 'filings.ndjson'), ndjson(filings));
writeFileSync(join(CACHE, 'candidates.ndjson'), ndjson(candidates));
const notVerbatim = candidates.filter((c) => !c.verbatim).length;
console.log(`${candidates.length} candidates, ${notVerbatim} not verbatim in the flat text`);
