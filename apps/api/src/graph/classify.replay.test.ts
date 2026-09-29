import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { UniverseSymbol } from '@kesher/shared';
import { describe, expect, it } from 'vitest';
import { classifyFiling, loadClassifyRecording, type Answer } from './classify';
import { COMPANIES } from '../seed/config';
import { loadFinnhubRecording, peerPairs, type FinnhubRecording } from './finnhub';
import { buildRows, CandidatesFile, DATA_DIR, loadResearch } from './rows';

// data/graph/candidates.json is rebuilt from committed inputs only: the sentences it holds, the
// recorded model answers, the research decisions and the Finnhub recordings. No provider is
// called (the client is null) and nothing is fetched from SEC.

describe('data/graph/candidates.json', () => {
  it('is reproduced exactly from the recordings, with no model call', async () => {
    const file = CandidatesFile.parse(
      JSON.parse(await readFile(resolve(DATA_DIR, 'candidates.json'), 'utf8')),
    );

    const answers = new Map<string, Map<UniverseSymbol, Answer>>();
    for (const filing of file.filings) {
      const sentences = file.sentences.filter((s) => s.accession === filing.accession);
      if (sentences.length === 0) continue;
      const recording = await loadClassifyRecording(filing.accession);
      const classified = await classifyFiling(filing.symbol, sentences, recording, null);
      expect(classified.called).toBe(0);
      for (const [id, byCompany] of classified.answers) answers.set(id, byCompany);
    }

    const finnhub: FinnhubRecording[] = [];
    for (const company of COMPANIES) {
      const recording = await loadFinnhubRecording(company.symbol);
      if (recording) finnhub.push(recording);
    }
    // The stored spans were checked against the filing text when the file was written.
    const quotes = new Set(file.rows.flatMap((r) => [r.quote, r.longQuote ?? r.quote]));
    const rows = buildRows({
      candidates: file.sentences,
      answers,
      research: (await loadResearch()).decisions,
      peers: peerPairs(finnhub),
      isVerbatim: (_, text) => quotes.has(text),
    });

    expect(rows).toEqual(file.rows);
    // Every span contains its own sentence, so no quote drifts away from the candidate.
    const sentenceOf = new Map(file.sentences.map((c) => [c.id, c.sentence]));
    for (const row of file.rows) {
      const sentence = sentenceOf.get(row.candidateId) ?? '#';
      expect(row.quote).toContain(sentence);
      if (row.longQuote !== null) expect(row.longQuote.endsWith(sentence)).toBe(true);
    }
  });
});
