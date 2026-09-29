import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { UniverseSymbol } from '@kesher/shared';
import { loadFinnhubEnv, loadModelKeys, loadSecEnv } from '../config/env';
import { createModelClient, resolveFromKeys } from '../llm/client';
import { COMPANIES } from '../seed/config';
import { collectCandidates, type CandidateSentence } from './candidates';
import {
  classifyFiling,
  classifyRecordingPath,
  ClassifyRecording,
  loadClassifyRecording,
  type Answer,
} from './classify';
import { FILERS } from './filers';
import {
  finnhubClient,
  finnhubRecordingPath,
  loadFinnhubRecording,
  peerPairs,
  profileDiffs,
  type FinnhubRecording,
} from './finnhub';
import { writeJson } from './json';
import {
  buildRows,
  CandidatesFile,
  DATA_DIR,
  loadResearch,
  proposedKeys,
  type FilingEntry,
} from './rows';
import { secFetcher } from '../sec/fetch';
import { filingHtml, findAnnual } from './sec';
import { flatText } from './sections';

// npm run graph:candidates
// Reads the latest annual report of every universe filer (cached in .cache/sec), finds candidate
// sentences, classifies them (replaying recordings/graph/classify, calling the model only for
// batches with no recording) and writes data/graph/candidates.json for the review. Finnhub peers
// and profiles are recorded once to recordings/finnhub. Writes nothing to the database.

parseArgs({ options: {} });

const get = secFetcher(loadSecEnv().SEC_USER_AGENT);
const client = createModelClient({ resolve: resolveFromKeys(loadModelKeys()) });

// Finnhub, recorded once per company.
let fetchFinnhub: ((symbol: UniverseSymbol) => Promise<FinnhubRecording>) | undefined;
const finnhub: FinnhubRecording[] = [];
for (const company of COMPANIES) {
  let recording = await loadFinnhubRecording(company.symbol);
  if (!recording) {
    fetchFinnhub ??= finnhubClient(loadFinnhubEnv().FINNHUB_API_KEY);
    recording = await fetchFinnhub(company.symbol);
    await writeJson(finnhubRecordingPath(company.symbol), recording);
  }
  finnhub.push(recording);
  const diffs = profileDiffs(company, recording);
  if (diffs.length > 0) console.log(`finnhub ${company.symbol.padEnd(5)} ${diffs.join('; ')}`);
}

const filings: FilingEntry[] = [];
const candidates: CandidateSentence[] = [];
const answers = new Map<string, Map<UniverseSymbol, Answer>>();
const flats = new Map<string, string>();
let called = 0;

for (const filer of FILERS) {
  const filing = await findAnnual(get, filer.ciks, filer.form);
  const { html } = await filingHtml(get, filing);
  flats.set(filing.accession, flatText(html));
  filings.push({ symbol: filer.symbol, ...filing });

  const collected = collectCandidates(filer, filing, html);
  candidates.push(...collected.candidates);
  let line = `${filer.symbol.padEnd(5)} ${filing.form} ${filing.accession} ${collected.candidates.length} candidates`;
  if (collected.notVerbatim > 0) line += `, ${collected.notVerbatim} not verbatim (skipped)`;

  if (collected.candidates.length > 0) {
    const recording = await loadClassifyRecording(filing.accession);
    const classified = await classifyFiling(filer.symbol, collected.candidates, recording, client);
    for (const [id, byCompany] of classified.answers) answers.set(id, byCompany);
    if (classified.called > 0 || !recording) {
      await writeJson(
        classifyRecordingPath(filing.accession),
        ClassifyRecording.parse({
          accession: filing.accession,
          recordedAt: new Date().toISOString(),
          batches: classified.batches,
        }),
      );
    }
    called += classified.called;
    const tokens = classified.batches.reduce((n, b) => n + (b.usage.totalTokens ?? 0), 0);
    line += `, ${classified.batches.length} batch(es), ${classified.called} called, ${tokens} tokens`;
    if (classified.ignored > 0) line += `, ${classified.ignored} answer(s) ignored`;
  }
  console.log(line);
}

const research = await loadResearch();
const rows = buildRows({
  candidates,
  answers,
  research: research.decisions,
  peers: peerPairs(finnhub),
  isVerbatim: (accession, text) => flats.get(accession)?.includes(text) ?? false,
});
const file = CandidatesFile.parse({ filings, sentences: candidates, rows });
await writeJson(resolve(DATA_DIR, 'candidates.json'), file);

// Summary for the checkpoint.
const ids = new Set(candidates.map((c) => c.id));
const unmatched = Object.keys(research.decisions).filter((id) => !ids.has(id));
const unanswered = rows.filter((r) => r.model === null).length;
const keys = proposedKeys(rows);
const byModel = new Set(
  rows.flatMap((r) =>
    r.proposals.filter((p) => !p.seeded && p.by.includes('model')).map((p) => p.key),
  ),
);
const byResearch = new Set(
  rows.flatMap((r) =>
    r.proposals.filter((p) => !p.seeded && p.by.includes('research')).map((p) => p.key),
  ),
);
const both = [...byModel].filter((k) => byResearch.has(k)).length;
console.log(
  [
    `${candidates.length} candidate sentences, ${rows.length} rows, ${unanswered} unanswered, ${called} model batch(es) called`,
    `research decisions not matched to a candidate: ${unmatched.length}${unmatched.length ? ` (${unmatched.join(', ')})` : ''}`,
    `relationships proposed for review (seeded excluded): ${keys.size}; model ${byModel.size}, research ${byResearch.size}, both ${both}`,
    `wrote ${resolve(DATA_DIR, 'candidates.json')}`,
  ].join('\n'),
);
