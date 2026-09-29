import { createHash } from 'node:crypto';
import { NonBlank, UniverseSymbol } from '@kesher/shared';
import { z } from 'zod';
import { EdgeRef } from './edges';
import type { Filer } from './filers';
import { mentions } from './filers';
import type { Filing } from './sec';
import { blocks, flatText, sections, sentences } from './sections';

// Candidate sentences: every sentence in the read sections that names another universe company.
// Code finds them by alias; the model only classifies them, and the user reviews every proposal.

export const CandidateId = z.string().regex(/^[0-9a-f]{10}$/);

export const CandidateSentence = z.strictObject({
  // sha1 of the accession and the sentence, the key docs/research/edge-candidates.md uses.
  id: CandidateId,
  filer: UniverseSymbol,
  accession: z.string(),
  section: NonBlank,
  sentence: NonBlank,
  // The sentence before it in the same section, for a role stated just before a list.
  previous: NonBlank.nullable(),
  // The other universe companies the sentence names, in universe order.
  companies: z.array(UniverseSymbol).min(1),
  // section: found in the sections the job reads. extra: a sentence outside them, added by hand
  // as a borderline candidate (EXTRA_SENTENCES).
  scope: z.enum(['section', 'extra']),
  // Set for extra sentences: the edge put up for review, and why it is only borderline.
  borderline: z.strictObject({ edge: EdgeRef, note: NonBlank }).nullable(),
});
export type CandidateSentence = z.infer<typeof CandidateSentence>;

export function candidateId(accession: string, sentence: string): string {
  return createHash('sha1').update(`${accession}\n${sentence}`).digest('hex').slice(0, 10);
}

export interface ExtraSentence {
  symbol: UniverseSymbol;
  section: string;
  // The sentence is found by its start in the whole report and must be found exactly once.
  startsWith: string;
  edge: EdgeRef;
  note: string;
}

// Sentences outside the read sections, added on the user's request as borderline candidates.
export const EXTRA_SENTENCES: ExtraSentence[] = [
  {
    symbol: 'ASML',
    section: 'Sustainability, Energy efficiency and climate action (page 174)',
    startsWith: 'In November 2025, we were honored to receive the TSMC Supplier',
    edge: { from: 'ASML', type: 'supplier_of', to: 'TSM' },
    note: 'Outside Item 3.D and Item 4, and the supplier role appears only in the name of the award. The only evidence for ASML supplying TSMC; added for review on 29 Sep 2026.',
  },
];

export interface Collected {
  candidates: CandidateSentence[];
  // Sentences that name a company but are not verbatim in the filing text; never candidates.
  notVerbatim: number;
}

export function collectCandidates(
  filer: Filer,
  filing: Pick<Filing, 'accession'>,
  html: string,
  extras: readonly ExtraSentence[] = EXTRA_SENTENCES,
): Collected {
  const flat = flatText(html);
  const wrapped = filer.form === '20-F';
  const others = (sentence: string) =>
    mentions(sentence)
      .map((m) => m.symbol)
      .filter((symbol) => symbol !== filer.symbol);

  const candidates: CandidateSentence[] = [];
  const seen = new Set<string>();
  let notVerbatim = 0;
  const list = blocks(html);

  for (const section of sections(list, filer.layout)) {
    const all = sentences(section.blocks, { wrapped });
    all.forEach((sentence, i) => {
      const companies = others(sentence);
      if (companies.length === 0) return;
      if (!flat.includes(sentence)) {
        notVerbatim++;
        return;
      }
      const id = candidateId(filing.accession, sentence);
      // The same sentence can appear twice in a report; one candidate is enough.
      if (seen.has(id)) return;
      seen.add(id);
      candidates.push(
        CandidateSentence.parse({
          id,
          filer: filer.symbol,
          accession: filing.accession,
          section: section.name,
          sentence,
          previous: all[i - 1] ?? null,
          companies,
          scope: 'section',
          borderline: null,
        }),
      );
    });
  }

  const extrasHere = extras.filter((extra) => extra.symbol === filer.symbol);
  if (extrasHere.length > 0) {
    const whole = sentences(list, { wrapped });
    for (const extra of extrasHere) {
      const found = whole.filter((s) => s.startsWith(extra.startsWith));
      const sentence = found[0];
      if (found.length !== 1 || sentence === undefined || !flat.includes(sentence)) {
        throw new Error(
          `${filer.symbol}: extra sentence found ${found.length} times, expected once`,
        );
      }
      const id = candidateId(filing.accession, sentence);
      if (seen.has(id)) continue;
      seen.add(id);
      candidates.push(
        CandidateSentence.parse({
          id,
          filer: filer.symbol,
          accession: filing.accession,
          section: extra.section,
          sentence,
          previous: null,
          companies: others(sentence),
          scope: 'extra',
          borderline: { edge: extra.edge, note: extra.note },
        }),
      );
    }
  }
  return { candidates, notVerbatim };
}
