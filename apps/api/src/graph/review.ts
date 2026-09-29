import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { NonBlank } from '@kesher/shared';
import { z } from 'zod';
import { EdgeRef, relationshipKey } from './edges';
import { CandidatesFile, DATA_DIR, type FilingEntry, type Row } from './rows';

// The user's review of every proposed relationship, data/graph/reviews.json. Nothing is written
// with reviewed: true unless a review here accepts it (SPEC.md principle 4, BACKLOG.md T11).

export const REVIEWS_PATH = resolve(DATA_DIR, 'reviews.json');
export const CANDIDATES_PATH = resolve(DATA_DIR, 'candidates.json');

export const Review = z
  .discriminatedUnion('decision', [
    z.strictObject({
      key: z.string(),
      decision: z.literal('accept'),
      // The edge as the chosen sentence states it; stored with its inverse.
      edge: EdgeRef,
      // The row whose quote is the evidence, and which of its spans was chosen.
      rowId: z.string(),
      span: z.enum(['sentence', 'long']),
      quote: NonBlank,
      decidedAt: z.iso.datetime(),
    }),
    z.strictObject({
      key: z.string(),
      decision: z.literal('reject'),
      decidedAt: z.iso.datetime(),
    }),
  ])
  .refine((review) => review.decision === 'reject' || relationshipKey(review.edge) === review.key, {
    error: 'the accepted edge does not belong to this relationship',
    path: ['edge'],
  });
export type Review = z.infer<typeof Review>;

export const ReviewsFile = z.strictObject({ reviews: z.array(Review) });
export type ReviewsFile = z.infer<typeof ReviewsFile>;

export interface Evidence {
  row: Row;
  filing: FilingEntry;
  // The edge this row proposes for the relationship, in the direction its sentence states.
  edge: EdgeRef;
}

export interface Group {
  key: string;
  evidence: Evidence[];
  finnhubPeer: boolean;
  borderline: boolean;
}

// One group per relationship that anyone proposed, seeded ones excluded. Supply relationships
// come first, then competitors, each sorted by key; evidence keeps the file's order.
export function groupRelationships(file: CandidatesFile): Group[] {
  const filings = new Map(file.filings.map((f) => [f.accession, f]));
  const groups = new Map<string, Group>();
  for (const row of file.rows) {
    const filing = filings.get(row.accession);
    if (!filing) throw new Error(`row ${row.id}: no filing ${row.accession}`);
    for (const proposal of row.proposals) {
      if (proposal.seeded) continue;
      const group = groups.get(proposal.key) ?? {
        key: proposal.key,
        evidence: [],
        finnhubPeer: false,
        borderline: false,
      };
      group.evidence.push({ row, filing, edge: proposal.edge });
      group.finnhubPeer ||= row.finnhubPeer;
      group.borderline ||= proposal.by.includes('borderline');
      groups.set(proposal.key, group);
    }
  }
  const rank = (key: string) => (key.startsWith('supply:') ? 0 : 1);
  return [...groups.values()].sort(
    (a, b) => rank(a.key) - rank(b.key) || a.key.localeCompare(b.key),
  );
}

// The relationships still to decide, and the one to decide again. A redo keeps the earlier
// decision until a new one replaces it, so skipping or quitting a redo loses nothing.
export function pending(
  groups: readonly Group[],
  reviews: readonly Review[],
  redo?: string,
): Group[] {
  const done = new Set(reviews.map((r) => r.key));
  return groups.filter((g) => g.key === redo || !done.has(g.key));
}

// Every review must still match the current candidates: an accept names a proposed relationship,
// a row among its evidence, the edge that row proposes, and that row's quote for the chosen span.
// Returns one line per stale review; step 5 refuses to write while any is left.
export function staleReviews(groups: readonly Group[], reviews: readonly Review[]): string[] {
  const byKey = new Map(groups.map((g) => [g.key, g]));
  const problems: string[] = [];
  for (const review of reviews) {
    const group = byKey.get(review.key);
    if (!group) {
      problems.push(`${review.key}: no longer proposed`);
      continue;
    }
    if (review.decision === 'reject') continue;
    const evidence = group.evidence.find((e) => e.row.id === review.rowId);
    if (!evidence) {
      problems.push(`${review.key}: row ${review.rowId} is no longer evidence for it`);
      continue;
    }
    const { from, type, to } = evidence.edge;
    if (review.edge.from !== from || review.edge.type !== type || review.edge.to !== to) {
      problems.push(`${review.key}: row ${review.rowId} now proposes ${from} ${type} ${to}`);
    }
    const quote = review.span === 'long' ? evidence.row.longQuote : evidence.row.quote;
    if (quote !== review.quote) {
      problems.push(`${review.key}: the quote of row ${review.rowId} changed`);
    }
  }
  return problems;
}

export type Input =
  | { kind: 'review'; review: Review }
  | { kind: 'skip' }
  | { kind: 'quit' }
  | { kind: 'invalid'; message: string };

// "3" accepts evidence 3 with its sentence, "3+" with the two sentence span, "r" rejects, "s"
// skips, "q" quits. Anything else is invalid and asks again.
export function parseInput(group: Group, input: string, now: Date): Input {
  const text = input.trim().toLowerCase();
  if (text === 'q') return { kind: 'quit' };
  if (text === 's') return { kind: 'skip' };
  const decidedAt = now.toISOString();
  if (text === 'r') {
    return { kind: 'review', review: { key: group.key, decision: 'reject', decidedAt } };
  }
  const match = /^(\d+)(\+)?$/.exec(text);
  const chosen = match ? group.evidence[Number(match[1]) - 1] : undefined;
  if (!match || !chosen) {
    return {
      kind: 'invalid',
      message: `Type 1 to ${group.evidence.length}, a number with + for the two sentence span, r, s or q.`,
    };
  }
  const long = match[2] === '+';
  if (long && chosen.row.longQuote === null) {
    return { kind: 'invalid', message: `Evidence ${match[1]} has no two sentence span.` };
  }
  if (relationshipKey(chosen.edge) !== group.key) {
    throw new Error(`evidence for ${group.key} proposes ${relationshipKey(chosen.edge)}`);
  }
  return {
    kind: 'review',
    review: {
      key: group.key,
      decision: 'accept',
      edge: chosen.edge,
      rowId: chosen.row.id,
      span: long ? 'long' : 'sentence',
      quote: long && chosen.row.longQuote !== null ? chosen.row.longQuote : chosen.row.quote,
      decidedAt,
    },
  };
}

// Replaces any earlier review of the same relationship; sorted by key for a stable file.
export function record(reviews: readonly Review[], review: Review): Review[] {
  return [...reviews.filter((r) => r.key !== review.key), review].sort((a, b) =>
    a.key.localeCompare(b.key),
  );
}

const ROLE_TEXT = {
  supplies_filer: 'supplies the filer',
  buys_from_filer: 'buys from the filer',
  competitor: 'competes with the filer',
  none: 'none',
} as const;

const edgeText = (edge: EdgeRef) => `${edge.from} ${edge.type} ${edge.to}`;

// Filing text is untrusted: control characters, including terminal escape sequences, never reach
// the terminal.
// eslint-disable-next-line no-control-regex
const printable = (text: string) => text.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ');

// The text shown for one relationship: every supporting quote in full, with its source.
export function renderGroup(group: Group, position: string): string {
  const [first] = group.evidence;
  const lines = [
    `${position}  ${group.key}${first ? `  (${edgeText(first.edge)})` : ''}`,
    `Finnhub peers: ${group.finnhubPeer ? 'yes' : 'no'}`,
  ];
  if (group.borderline) {
    lines.push('BORDERLINE: added by hand from outside the read sections; decide on the quote.');
  }
  group.evidence.forEach(({ row, filing, edge }, i) => {
    const model = row.model
      ? `${ROLE_TEXT[row.model.role]}${row.model.usesPrevious ? ', role in the previous sentence' : ''}`
      : 'no answer';
    const research = row.research
      ? `${row.research.decision}${row.research.edges.some((e) => e.pick) ? ' (picked)' : ''}${row.research.reason ? `: ${row.research.reason}` : ''}`
      : 'not in the research';
    lines.push(
      '',
      `  ${i + 1}. ${row.filer} ${filing.form}, ${row.section}, filed ${filing.filingDate}. Proposes ${edgeText(edge)}`,
      `     model: ${model}. research: ${research}`,
    );
    if (row.borderline) lines.push(`     borderline: ${row.borderline}`);
    if (row.research?.note) lines.push(`     research note: ${row.research.note}`);
    lines.push(`     "${printable(row.quote)}"`);
    if (row.longQuote !== null) {
      lines.push(`     ${i + 1}+ quotes two sentences: "${printable(row.longQuote)}"`);
    }
    lines.push(`     ${filing.url}`);
  });
  return lines.join('\n');
}

export async function loadCandidates(path = CANDIDATES_PATH): Promise<CandidatesFile> {
  return CandidatesFile.parse(JSON.parse(await readFile(path, 'utf8')));
}

export async function loadReviews(path = REVIEWS_PATH): Promise<Review[]> {
  let contents: string;
  try {
    contents = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  return ReviewsFile.parse(JSON.parse(contents)).reviews;
}
