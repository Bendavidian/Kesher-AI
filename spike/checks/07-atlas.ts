// MongoDB Atlas free tier: a vector index over real embeddings, one $vectorSearch and one $graphLookup.
// Works in its own database and drops it at the end, so the M0 limit of 3 search indexes stays free.
import { MongoClient } from 'mongodb';
import { sleep, type Check } from '../lib.ts';

const DB = 'kesher_spike';
const INDEX = 'spike_vec';

interface Vectors {
  embedder: string;
  model: string;
  dims: number;
  docs: { id: string; kind: string; text: string; embedding: number[] }[];
  queries: { text: string; expectTop: string[]; embedding: number[] }[];
}

const check: Check = {
  name: 'atlas',
  title: 'MongoDB Atlas: vector index, $vectorSearch and $graphLookup',
  keys: ['MONGODB_URI'],
  async run(ctx) {
    const limits = [
      'M0: 512 MB storage, at most 3 Atlas Search or Vector Search indexes per cluster.',
    ];
    const vectors = ctx.readOutput<Vectors>('embeddings-vectors');
    if (!vectors) {
      return { status: 'fail', reason: 'No embeddings from the embeddings check', evidence: {}, limits };
    }

    const client = new MongoClient(ctx.env('MONGODB_URI')!, { serverSelectionTimeoutMS: 20_000, appName: 'kesher-spike' });
    const evidence: Record<string, unknown> = { embedder: vectors.embedder, model: vectors.model, dims: vectors.dims };
    let started = performance.now();
    try {
      await client.connect();
      const db = client.db(DB);
      await db.dropDatabase();
      const admin = await db.admin().command({ buildInfo: 1 });
      evidence.connectMs = Math.round(performance.now() - started);
      evidence.serverVersion = admin.version;

      // Vector search.
      const chunks = db.collection('chunks');
      await chunks.insertMany(vectors.docs.map((d) => ({ _id: d.id as any, kind: d.kind, text: d.text, embedding: d.embedding })));
      started = performance.now();
      await chunks.createSearchIndex({
        name: INDEX,
        type: 'vectorSearch',
        definition: { fields: [{ type: 'vector', path: 'embedding', numDimensions: vectors.dims, similarity: 'cosine' }] },
      });
      let queryable = false;
      while (!queryable && performance.now() - started < 180_000) {
        await sleep(3_000);
        const [idx] = await chunks.listSearchIndexes(INDEX).toArray();
        queryable = !!idx?.queryable;
      }
      evidence.indexReadyMs = Math.round(performance.now() - started);
      if (!queryable) return { status: 'fail', reason: 'Vector index not queryable within 3 minutes', evidence, limits };
      ctx.log(`vector index queryable after ${Math.round((evidence.indexReadyMs as number) / 1000)} s`);

      const searches = [];
      for (const q of vectors.queries) {
        started = performance.now();
        const hits = await chunks
          .aggregate([
            { $vectorSearch: { index: INDEX, path: 'embedding', queryVector: q.embedding, numCandidates: 20, limit: 3 } },
            { $project: { _id: 1, score: { $meta: 'vectorSearchScore' } } },
          ])
          .toArray();
        const top = hits.slice(0, q.expectTop.length).map((h) => String(h._id));
        searches.push({
          query: q.text,
          ms: Math.round(performance.now() - started),
          hits: hits.map((h) => ({ id: h._id, score: Number(h.score.toFixed(4)) })),
          ok: q.expectTop.every((id) => top.includes(id)),
        });
      }
      evidence.vectorSearch = searches;

      // $graphLookup: from the event company outward, at most 2 hops (maxDepth 1).
      const edges = db.collection('edges');
      await edges.insertMany([
        { from: 'TSM', to: 'NVDA', type: 'supplier_of' },
        { from: 'NVDA', to: 'user:A', type: 'held_by' },
        { from: 'TSM', to: 'user:B', type: 'held_by' },
        { from: 'KO', to: 'user:C', type: 'held_by' },
      ]);
      await db.collection('events').insertOne({ _id: 'evt_tsm' as any, company: 'TSM' });
      started = performance.now();
      const [graph] = await db
        .collection('events')
        .aggregate([
          { $match: { _id: 'evt_tsm' } },
          {
            $graphLookup: {
              from: 'edges',
              startWith: '$company',
              connectFromField: 'to',
              connectToField: 'from',
              as: 'reached',
              maxDepth: 1,
              depthField: 'depth',
            },
          },
        ])
        .toArray();
      const reached = (graph.reached as any[])
        .map((e) => ({ from: e.from, to: e.to, type: e.type, depth: e.depth }))
        .sort((a, b) => a.depth - b.depth);
      const users = reached.filter((e) => e.to.startsWith('user:')).map((e) => `${e.to}@hop${e.depth + 1}`);
      const graphOk = users.includes('user:B@hop1') && users.includes('user:A@hop2') && !users.some((u) => u.startsWith('user:C'));
      evidence.graphLookup = { ms: Math.round(performance.now() - started), reached, usersReached: users, ok: graphOk };
      ctx.log(`graphLookup reached ${users.join(', ')}`);

      const vectorOk = searches.every((s) => s.ok);
      if (vectorOk && graphOk) return { status: 'pass', evidence, limits };
      return {
        status: 'fail',
        reason: `${vectorOk ? '' : 'vector search ranking wrong; '}${graphOk ? '' : 'graph reach wrong'}`.trim(),
        evidence,
        limits,
      };
    } finally {
      try {
        await client.db(DB).dropDatabase();
        evidence.cleanedUp = true;
      } catch {
        evidence.cleanedUp = false;
      }
      await client.close();
    }
  },
};

export default check;
