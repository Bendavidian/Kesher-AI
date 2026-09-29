import { randomUUID } from 'node:crypto';
import { Relationship, Source } from '@kesher/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { collection } from '../db/collections';
import { runSeed } from '../seed/seed';
import { MONGO_START_TIMEOUT_MS, startTestMongo, type TestMongo } from '../test/mongo';
import { applyReviews, countRelationships } from './apply';
import { groupRelationships, loadCandidates, parseInput, type Review } from './review';
import type { CandidatesFile } from './rows';

const now = new Date('2026-09-29T12:00:00.000Z');

describe('applyReviews on mongod', () => {
  let mongo: TestMongo;
  let file: CandidatesFile;
  let seedEdges: Relationship[];
  let accept: (key: string, choice?: string) => Review;
  const reject = (key: string): Review => ({
    key,
    decision: 'reject',
    decidedAt: now.toISOString(),
  });

  const edges = async () =>
    (await collection(mongo.db, 'relationships').find({}).toArray())
      .map((e) => Relationship.parse(e))
      .sort((a, b) => a._id.localeCompare(b._id));
  const texts = (list: Relationship[]) => list.map((e) => `${e.from} ${e.type} ${e.to}`).sort();

  beforeAll(async () => {
    mongo = await startTestMongo('kesher_apply_test');
    await runSeed(mongo.db, now);
    seedEdges = await edges();
    file = await loadCandidates();
    const groups = groupRelationships(file);
    accept = (key, choice = '1') => {
      const group = groups.find((g) => g.key === key);
      if (!group) throw new Error(`no group ${key}`);
      const input = parseInput(group, choice, now);
      if (input.kind !== 'review') throw new Error(`no review for ${key}`);
      return input.review;
    };
  }, MONGO_START_TIMEOUT_MS);

  afterAll(async () => {
    await mongo?.stop();
  });

  const reviews = () => [
    accept('supply:ASML>INTC'),
    accept('competitor:AMAT|ASML'),
    reject('supply:MSFT>AMD'),
  ];

  it('plans without writing in a dry run', async () => {
    const plan = await applyReviews(mongo.db, file, reviews(), { now, dryRun: true });
    expect(plan.inserted).toHaveLength(4);
    expect(plan.sourcesInserted).toHaveLength(2);
    expect(await edges()).toEqual(seedEdges);
    expect(await collection(mongo.db, 'sources').countDocuments()).toBe(4);
  });

  it('writes only accepted relationships, with inverses, evidence and new filing Sources', async () => {
    const plan = await applyReviews(mongo.db, file, reviews(), { now });

    expect(plan).toMatchObject({ updated: [], unchanged: 0, deleted: [], sourcesExisting: 0 });
    expect(plan.sourcesInserted).toHaveLength(2);
    const all = await edges();
    const added = all.filter((e) => !seedEdges.some((s) => s._id === e._id));
    expect(texts(added)).toEqual([
      'AMAT competitor_of ASML',
      'ASML competitor_of AMAT',
      'ASML supplier_of INTC',
      'INTC customer_of ASML',
    ]);
    expect([...plan.inserted].sort()).toEqual(texts(added));
    for (const edge of added) {
      expect(edge.evidence.reviewed).toBe(true);
      const source = Source.parse(
        await collection(mongo.db, 'sources').findOne({ _id: edge.evidence.sourceId }),
      );
      expect(source).toMatchObject({ provider: 'sec_edgar', kind: 'filing', tier: 1, text: null });
      expect(edge.evidence.url).toBe(source.url);
    }
    expect(added.find((e) => e.type === 'supplier_of')?.weight).toBe(0.8);
    expect(added.find((e) => e.type === 'competitor_of')?.weight).toBe(0.6);
    // The seeded edges are exactly as the seed wrote them.
    expect(all.filter((e) => seedEdges.some((s) => s._id === e._id))).toEqual(seedEdges);
  });

  it('changes nothing when run again', async () => {
    const before = await edges();
    const plan = await applyReviews(mongo.db, file, reviews(), {
      now: new Date(now.getTime() + 60_000),
    });
    expect(plan).toEqual({
      sourcesInserted: [],
      sourcesExisting: 2,
      inserted: [],
      updated: [],
      unchanged: 4,
      deleted: [],
    });
    expect(await edges()).toEqual(before);
  });

  it('removes nothing when a review is missing from a partial or older file', async () => {
    const before = await edges();
    const plan = await applyReviews(mongo.db, file, [accept('supply:ASML>INTC')], { now });
    expect(plan.deleted).toEqual([]);
    expect(await edges()).toEqual(before);
  });

  it('refuses an empty review list and a relationship reviewed twice', async () => {
    const before = await edges();
    await expect(applyReviews(mongo.db, file, [], { now })).rejects.toThrow('no reviews to apply');
    await expect(
      applyReviews(mongo.db, file, [accept('supply:ASML>INTC'), reject('supply:ASML>INTC')], {
        now,
      }),
    ).rejects.toThrow('supply:ASML>INTC is reviewed twice');
    expect(await edges()).toEqual(before);
  });

  it('refuses stale reviews and writes nothing', async () => {
    const before = await edges();
    const stale = { ...accept('supply:ASML>INTC'), quote: 'A quote the filing never had.' };
    await expect(applyReviews(mongo.db, file, [stale], { now })).rejects.toThrow(
      'reviews do not match the candidates',
    );
    expect(await edges()).toEqual(before);
  });

  it('removes the edges of a relationship rejected later, and nothing else', async () => {
    // An edge this job never wrote stays, even though no review accepts it.
    const outside = Relationship.parse({
      _id: randomUUID(),
      from: 'KO',
      to: 'JNJ',
      type: 'competitor_of',
      weight: 0.6,
      evidence: {
        sourceId: randomUUID(),
        quote: 'Written by something else.',
        filingDate: '2026-01-01',
        url: 'https://example.com/filing',
        reviewed: false,
      },
      createdAt: now,
    });
    await collection(mongo.db, 'relationships').insertOne(outside);

    const plan = await applyReviews(
      mongo.db,
      file,
      [accept('supply:ASML>INTC'), reject('competitor:AMAT|ASML')],
      { now },
    );

    expect([...plan.deleted].sort()).toEqual([
      'AMAT competitor_of ASML',
      'ASML competitor_of AMAT',
    ]);
    const left = await edges();
    expect(left.some((e) => e._id === outside._id)).toBe(true);
    expect(await countRelationships(mongo.db)).toEqual({
      relationships: 7,
      seeded: 6,
      t11: 1,
      documents: 14,
      missingInverse: [],
    });
  });

  it('leaves a seeded filing Source untouched when a new edge cites it', async () => {
    const nvda = file.filings.find((f) => f.symbol === 'NVDA');
    const before = await collection(mongo.db, 'sources').findOne({ externalId: nvda?.accession });
    await applyReviews(mongo.db, file, [accept('supply:MU>NVDA')], { now });
    const after = await collection(mongo.db, 'sources').findOne({ externalId: nvda?.accession });
    expect(after).toEqual(before);
  });
});
