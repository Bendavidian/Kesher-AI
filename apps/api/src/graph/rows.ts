import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { NonBlank, UniverseSymbol } from '@kesher/shared';
import { z } from 'zod';
import { CandidateId, CandidateSentence } from './candidates';
import type { Answer } from './classify';
import { EdgeRef, Role, relationshipKey, roleEdge, SEEDED_KEYS } from './edges';
import { peerKey } from './finnhub';

// data/graph/candidates.json: one row per (candidate sentence, company it names), with what the
// model proposed, what the research decided and whether Finnhub lists the pair as peers. The
// review CLI reads it; nothing here is reviewed or written to the database.

export const DATA_DIR = resolve(import.meta.dirname, '../../../../data/graph');

const ResearchEdge = EdgeRef.extend({ pick: z.boolean() });

export const ResearchDecision = z.strictObject({
  decision: z.enum(['accept', 'borderline', 'reject']),
  edges: z.array(ResearchEdge),
  reason: z.string().optional(),
  quote: z.string().optional(),
  note: z.string().optional(),
});
export type ResearchDecision = z.infer<typeof ResearchDecision>;

// data/graph/research-decisions.json, exported once from research/edges/review.ts.
export const ResearchFile = z.strictObject({
  source: z.string(),
  decisions: z.record(CandidateId, ResearchDecision),
});
export type ResearchFile = z.infer<typeof ResearchFile>;

export async function loadResearch(dir = DATA_DIR): Promise<ResearchFile> {
  return ResearchFile.parse(
    JSON.parse(await readFile(resolve(dir, 'research-decisions.json'), 'utf8')),
  );
}

export const ProposedBy = z.enum(['model', 'research', 'borderline']);
export type ProposedBy = z.infer<typeof ProposedBy>;

export const Proposal = z.strictObject({
  key: z.string(),
  edge: EdgeRef,
  by: z.array(ProposedBy).min(1),
  // The seed owns this relationship; T11 skips it (SPEC.md decision log, T11).
  seeded: z.boolean(),
});
export type Proposal = z.infer<typeof Proposal>;

export const Row = z.strictObject({
  id: z.string(),
  candidateId: CandidateId,
  filer: UniverseSymbol,
  company: UniverseSymbol,
  accession: z.string(),
  section: NonBlank,
  scope: z.enum(['section', 'extra']),
  // The verbatim evidence span proposed by default: the sentence, or the research's own span.
  // Always found in the filing text.
  quote: NonBlank,
  // The previous sentence and the sentence, when the model says the role is stated just before
  // it and the span is verbatim. Offered in the review; never chosen without the user.
  longQuote: NonBlank.nullable(),
  model: z
    .strictObject({
      role: Role,
      usesPrevious: z.boolean(),
      provider: z.string(),
      model: z.string(),
    })
    .nullable(),
  research: z
    .strictObject({
      decision: ResearchDecision.shape.decision,
      edges: z.array(ResearchEdge),
      reason: z.string().optional(),
      note: z.string().optional(),
    })
    .nullable(),
  borderline: z.string().nullable(),
  finnhubPeer: z.boolean(),
  proposals: z.array(Proposal),
});
export type Row = z.infer<typeof Row>;

export const FilingEntry = z.strictObject({
  symbol: UniverseSymbol,
  form: z.enum(['10-K', '20-F']),
  cik: z.string().regex(/^\d{10}$/),
  accession: z.string().regex(/^\d{10}-\d{2}-\d{6}$/),
  filingDate: z.iso.date(),
  reportDate: z.iso.date(),
  acceptedAt: z.iso.datetime(),
  url: z.httpUrl(),
});
export type FilingEntry = z.infer<typeof FilingEntry>;

// The sentences are kept next to the rows, so the rows can be rebuilt from this file and the
// recordings alone (classify.replay.test.ts), with no provider call and no SEC fetch.
export const CandidatesFile = z.strictObject({
  filings: z.array(FilingEntry),
  sentences: z.array(CandidateSentence),
  rows: z.array(Row),
});
export type CandidatesFile = z.infer<typeof CandidatesFile>;

export interface RowInputs {
  candidates: readonly CandidateSentence[];
  answers: ReadonlyMap<string, ReadonlyMap<UniverseSymbol, Answer>>;
  research: ResearchFile['decisions'];
  peers: ReadonlySet<string>;
  // Whether a span is verbatim in that filing's text.
  isVerbatim: (accession: string, text: string) => boolean;
}

const involves = (edge: EdgeRef, company: UniverseSymbol) =>
  edge.from === company || edge.to === company;

export function buildRows({ candidates, answers, research, peers, isVerbatim }: RowInputs): Row[] {
  const rows: Row[] = [];
  for (const candidate of candidates) {
    const decision = research[candidate.id];
    for (const company of candidate.companies) {
      const answer = answers.get(candidate.id)?.get(company);
      const researchEdges = (decision?.edges ?? []).filter((e) => involves(e, company));

      const proposals = new Map<string, Proposal>();
      const propose = (edge: EdgeRef, by: ProposedBy) => {
        const key = relationshipKey(edge);
        const existing = proposals.get(key);
        if (existing) {
          if (!existing.by.includes(by)) existing.by.push(by);
          return;
        }
        const { from, type, to } = edge;
        proposals.set(key, {
          key,
          edge: { from, type, to },
          by: [by],
          seeded: SEEDED_KEYS.has(key),
        });
      };
      const modelEdge = answer ? roleEdge(candidate.filer, company, answer.role) : null;
      if (modelEdge) propose(modelEdge, 'model');
      if (decision && decision.decision !== 'reject') {
        for (const edge of researchEdges) propose(edge, 'research');
      }
      if (candidate.borderline && involves(candidate.borderline.edge, company)) {
        propose(candidate.borderline.edge, 'borderline');
      }

      // Evidence stays as tight as it can: the sentence, unless the research chose a longer
      // verbatim span. The model's two sentence span is only offered. The sentence alone is
      // always verbatim (collectCandidates).
      const verbatim = (span: string | null | undefined): span is string =>
        typeof span === 'string' && isVerbatim(candidate.accession, span);
      const quote =
        verbatim(decision?.quote) && decision.quote.includes(candidate.sentence)
          ? decision.quote
          : candidate.sentence;
      const joined =
        candidate.previous === null ? null : `${candidate.previous} ${candidate.sentence}`;
      const longQuote =
        answer?.usesPrevious && modelEdge && joined !== quote && verbatim(joined) ? joined : null;

      rows.push(
        Row.parse({
          id: `${candidate.id}:${company}`,
          candidateId: candidate.id,
          filer: candidate.filer,
          company,
          accession: candidate.accession,
          section: candidate.section,
          scope: candidate.scope,
          quote,
          longQuote,
          model: answer
            ? {
                role: answer.role,
                usesPrevious: answer.usesPrevious,
                provider: answer.provider,
                model: answer.model,
              }
            : null,
          research: decision
            ? {
                decision: decision.decision,
                edges: researchEdges,
                ...(decision.reason ? { reason: decision.reason } : {}),
                ...(decision.note ? { note: decision.note } : {}),
              }
            : null,
          borderline: candidate.borderline?.note ?? null,
          finnhubPeer: peers.has(peerKey(candidate.filer, company)),
          proposals: [...proposals.values()],
        }),
      );
    }
  }
  return rows;
}

// Distinct relationships proposed by anyone, the seeded ones excluded: what the review covers.
export function proposedKeys(rows: readonly Row[]): Set<string> {
  return new Set(rows.flatMap((r) => r.proposals.filter((p) => !p.seeded).map((p) => p.key)));
}
