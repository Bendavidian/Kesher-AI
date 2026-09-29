import { randomUUID } from 'node:crypto';
import { EDGE_WEIGHTS, Relationship, Source, withInverse } from '@kesher/shared';
import type { AnyBulkWriteOperation, Db } from 'mongodb';
import { collection } from '../db/collections';
import { COMPANIES } from '../seed/config';
import { relationshipKey, SEEDED_KEYS } from './edges';
import { groupRelationships, staleReviews, type Review } from './review';
import type { CandidatesFile, FilingEntry } from './rows';

// Writes the relationships the user accepted in data/graph/reviews.json, each with its inverse
// and reviewed: true, and nothing else (SPEC.md principle 4). The seed owns six edges (SPEC.md
// decision log, T11) that are never touched. An edge is removed only when the user rejected its
// relationship in reviews.json, so a missing, partial or older reviews file removes nothing.
// The filing Sources behind the evidence are inserted once and never modified. A rerun is safe
// after any failure: every write is an upsert on a unique key.

const NAME = new Map(COMPANIES.map((c) => [c.symbol, c.name]));

export function filingSource(filing: FilingEntry, now: Date): Source {
  return Source.parse({
    _id: randomUUID(),
    provider: 'sec_edgar',
    kind: 'filing',
    tier: 1,
    externalId: filing.accession,
    url: filing.url,
    author: null,
    publisher: null,
    title: `${NAME.get(filing.symbol) ?? filing.symbol} ${filing.form} for the fiscal year ended ${filing.reportDate}`,
    symbols: [filing.symbol],
    // Filing text lives in FilingChunk, not on the Source.
    text: null,
    publishedAt: new Date(filing.acceptedAt),
    // Filings are reviewed by hand, not screened; the pipeline screens what it ingests.
    injectionScreen: null,
    createdAt: now,
  });
}

export interface ApplyPlan {
  // Accession numbers of the filing Sources inserted (or, in a dry run, to insert).
  sourcesInserted: string[];
  sourcesExisting: number;
  // Edge documents as "from type to".
  inserted: string[];
  updated: string[];
  unchanged: number;
  deleted: string[];
}

export interface ApplyOptions {
  now?: Date;
  // Computes the plan and writes nothing.
  dryRun?: boolean;
}

const edgeText = (e: Pick<Relationship, 'from' | 'type' | 'to'>) => `${e.from} ${e.type} ${e.to}`;
const sameEvidence = (a: Relationship['evidence'], b: Relationship['evidence']) =>
  a.sourceId === b.sourceId &&
  a.quote === b.quote &&
  a.filingDate === b.filingDate &&
  a.url === b.url &&
  a.reviewed === b.reviewed;

export async function applyReviews(
  db: Db,
  file: CandidatesFile,
  reviews: readonly Review[],
  { now = new Date(), dryRun = false }: ApplyOptions = {},
): Promise<ApplyPlan> {
  // A missing or emptied reviews file must never look like "reject everything".
  if (reviews.length === 0) throw new Error('no reviews to apply');
  const keys = reviews.map((r) => r.key);
  const duplicate = keys.find((key, i) => keys.indexOf(key) !== i);
  if (duplicate) throw new Error(`${duplicate} is reviewed twice`);
  const groups = groupRelationships(file);
  const stale = staleReviews(groups, reviews);
  if (stale.length > 0) throw new Error(`reviews do not match the candidates: ${stale.join('; ')}`);

  const rows = new Map(file.rows.map((r) => [r.id, r]));
  const filings = new Map(file.filings.map((f) => [f.accession, f]));
  const accepted = reviews.flatMap((review) => {
    if (review.decision !== 'accept') return [];
    if (SEEDED_KEYS.has(review.key)) throw new Error(`${review.key} is a seeded edge`);
    const row = rows.get(review.rowId);
    const filing = row && filings.get(row.accession);
    if (!row || !filing) throw new Error(`${review.key}: no row or filing for ${review.rowId}`);
    return [{ review, filing }];
  });
  // Only a relationship the user rejected is ever removed, and never a seeded one.
  const rejected = new Set(
    reviews.filter((r) => r.decision === 'reject' && !SEEDED_KEYS.has(r.key)).map((r) => r.key),
  );

  // Sources first, insert only; evidence points at the stored ids.
  const needed = [...new Map(accepted.map(({ filing }) => [filing.accession, filing])).values()];
  const sources = collection(db, 'sources');
  const storedIds = async () =>
    new Map(
      (
        await sources
          .find({ provider: 'sec_edgar', externalId: { $in: needed.map((f) => f.accession) } })
          .project<{ _id: string; externalId: string }>({ _id: 1, externalId: 1 })
          .toArray()
      ).map((s) => [s.externalId, s._id]),
    );
  let sourceIds = await storedIds();
  const newSources = needed.filter((f) => !sourceIds.has(f.accession));
  if (!dryRun && newSources.length > 0) {
    await sources.bulkWrite(
      newSources.map((filing) => ({
        updateOne: {
          filter: { provider: 'sec_edgar', externalId: filing.accession },
          update: { $setOnInsert: filingSource(filing, now) },
          upsert: true,
        },
      })),
      { ordered: true },
    );
    sourceIds = await storedIds();
  }

  const docs = accepted.flatMap(({ review, filing }) => {
    if (review.decision !== 'accept') return [];
    // In a dry run a Source still to insert has no id yet; a placeholder keeps the plan honest.
    const sourceId = sourceIds.get(filing.accession) ?? (dryRun ? randomUUID() : undefined);
    if (!sourceId) throw new Error(`no Source for filing ${filing.accession}`);
    const evidence = {
      sourceId,
      quote: review.quote,
      filingDate: filing.filingDate,
      url: filing.url,
      reviewed: true,
    };
    const edge = { ...review.edge, weight: EDGE_WEIGHTS[review.edge.type], evidence };
    return withInverse(edge).map((e) =>
      Relationship.parse({ _id: randomUUID(), ...e, createdAt: now }),
    );
  });

  const relationships = collection(db, 'relationships');
  const existing = new Map(
    (await relationships.find({}).toArray()).map((doc) => {
      const edge = Relationship.parse(doc);
      return [`${edge.from}|${edge.type}|${edge.to}`, edge] as const;
    }),
  );
  const inserted: Relationship[] = [];
  const updated: Relationship[] = [];
  let unchanged = 0;
  for (const doc of docs) {
    const current = existing.get(`${doc.from}|${doc.type}|${doc.to}`);
    if (!current) inserted.push(doc);
    else if (current.weight === doc.weight && sameEvidence(current.evidence, doc.evidence)) {
      unchanged++;
    } else updated.push(doc);
  }
  const toDelete = [...existing.values()].filter((e) => rejected.has(relationshipKey(e)));

  if (!dryRun) {
    const operations: AnyBulkWriteOperation<Relationship>[] = [...inserted, ...updated].map(
      ({ _id, createdAt, ...fields }) => ({
        updateOne: {
          filter: { from: fields.from, to: fields.to, type: fields.type },
          update: {
            $set: { weight: fields.weight, evidence: fields.evidence },
            $setOnInsert: { _id, createdAt },
          },
          upsert: true,
        },
      }),
    );
    if (operations.length > 0) await relationships.bulkWrite(operations, { ordered: true });
    if (toDelete.length > 0) {
      await relationships.deleteMany({ _id: { $in: toDelete.map((e) => e._id) } });
    }
  }

  return {
    sourcesInserted: newSources.map((f) => f.accession),
    sourcesExisting: needed.length - newSources.length,
    inserted: inserted.map(edgeText),
    updated: updated.map(edgeText),
    unchanged,
    deleted: toDelete.map(edgeText),
  };
}

export interface GraphCount {
  // Distinct relationships: a relationship and its inverse count once (relationshipKey).
  relationships: number;
  seeded: number;
  t11: number;
  documents: number;
  // Reviewed edges stored without their inverse; always empty unless something is wrong.
  missingInverse: string[];
}

// The acceptance count for T11, read from the database: reviewed edges only.
export async function countRelationships(db: Db): Promise<GraphCount> {
  const edges = await collection(db, 'relationships')
    .find({ 'evidence.reviewed': true })
    .project<Pick<Relationship, 'from' | 'to' | 'type'>>({ _id: 0, from: 1, to: 1, type: 1 })
    .toArray();
  const present = new Set(edges.map((e) => `${e.from}|${e.type}|${e.to}`));
  const missingInverse = edges
    .filter((e) => {
      const [, inverse] = withInverse(e);
      return !present.has(`${inverse.from}|${inverse.type}|${inverse.to}`);
    })
    .map((e) => `${e.from} ${e.type} ${e.to}`);
  const keys = new Set(edges.map((e) => relationshipKey(e)));
  const seeded = [...keys].filter((k) => SEEDED_KEYS.has(k)).length;
  return {
    relationships: keys.size,
    seeded,
    t11: keys.size - seeded,
    documents: edges.length,
    missingInverse,
  };
}
