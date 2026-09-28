// Embeddings at zero cost: Gemini on the free tier vs local all-MiniLM-L6-v2.
// Both embed the same documents and queries, and a small retrieval sanity test compares them.
// The recommended option's vectors are saved for the Atlas check.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { embed, embedMany } from 'ai';
import { google } from '@ai-sdk/google';
import { cosine, errorMessage, type Check, type Ctx } from '../lib.ts';
import { listGeminiModels } from './05-gemini.ts';

const LOCAL_MODEL = 'Xenova/all-MiniLM-L6-v2';

interface Doc {
  id: string;
  kind: string;
  text: string;
}

// Distractors are synthetic, written for this test only.
function buildCorpus(ctx: Ctx) {
  const sec = ctx.readOutput<{ evidence?: { quote?: string } }>('sec');
  const item = ctx.readOutput<{ headline: string }>('tsmc-item');
  const docs: Doc[] = [
    {
      id: 'foundry',
      kind: sec?.evidence?.quote ? 'NVIDIA 10-K passage (SEC check)' : 'synthetic',
      text: sec?.evidence?.quote ?? 'We rely on third-party foundries such as TSMC to manufacture our semiconductor wafers.',
    },
    {
      id: 'tsmc_headline',
      kind: item ? 'Alpaca news headline' : 'synthetic',
      text: item?.headline ?? 'TSMC evacuates some fabs after a strong earthquake in Taiwan',
    },
    { id: 'ko', kind: 'synthetic', text: 'Coca-Cola raises its quarterly dividend and reaffirms full-year guidance.' },
    { id: 'xom', kind: 'synthetic', text: 'Exxon Mobil reports higher oil and gas production in the Permian Basin.' },
    { id: 'jnj', kind: 'synthetic', text: 'Johnson & Johnson receives FDA approval for a new oncology treatment.' },
  ];
  const queries = [
    { text: 'foundry dependency', expectTop: ['foundry'] },
    { text: 'semiconductor manufacturing in Taiwan', expectTop: ['foundry', 'tsmc_headline'] },
  ];
  return { docs, queries };
}

function sanity(docs: Doc[], docVecs: number[][], queries: { text: string; expectTop: string[] }[], queryVecs: number[][]) {
  return queries.map((q, qi) => {
    const ranked = docs
      .map((d, di) => ({ id: d.id, score: Number(cosine(queryVecs[qi], docVecs[di]).toFixed(4)) }))
      .sort((a, b) => b.score - a.score);
    const top = ranked.slice(0, q.expectTop.length).map((r) => r.id);
    const ok = q.expectTop.every((id) => top.includes(id));
    const bestDistractor = ranked.find((r) => !q.expectTop.includes(r.id))!;
    const worstExpected = ranked.filter((r) => q.expectTop.includes(r.id)).at(-1)!;
    return { query: q.text, ok, margin: Number((worstExpected.score - bestDistractor.score).toFixed(4)), ranked };
  });
}

async function runGemini(ctx: Ctx, docs: Doc[], queries: { text: string }[]) {
  const models = await listGeminiModels(ctx.env('GOOGLE_GENERATIVE_AI_API_KEY')!);
  const names = models
    .filter((m) => m.supportedGenerationMethods.includes('embedContent'))
    .map((m) => m.name.replace(/^models\//, ''));
  const modelId = ['gemini-embedding-2', 'gemini-embedding-001'].find((m) => names.includes(m)) ?? names[0];
  if (!modelId) throw new Error('No Gemini embedding model available');
  ctx.log(`gemini embedding model ${modelId}`);
  const model = google.embedding(modelId);

  let started = performance.now();
  const batch = await embedMany({
    model,
    values: docs.map((d) => d.text),
    maxRetries: 0,
    providerOptions: { google: { taskType: 'RETRIEVAL_DOCUMENT' } },
  });
  const batchMs = Math.round(performance.now() - started);

  const queryVecs: number[][] = [];
  const queryMs: number[] = [];
  for (const q of queries) {
    started = performance.now();
    const r = await embed({ model, value: q.text, maxRetries: 0, providerOptions: { google: { taskType: 'RETRIEVAL_QUERY' } } });
    queryMs.push(Math.round(performance.now() - started));
    queryVecs.push(r.embedding);
  }
  return {
    model: modelId,
    candidates: names,
    dims: batch.embeddings[0].length,
    batchOf: docs.length,
    batchMs,
    singleQueryMs: queryMs,
    usage: batch.usage,
    docVecs: batch.embeddings,
    queryVecs,
  };
}

async function runLocal(ctx: Ctx, docs: Doc[], queries: { text: string }[]) {
  const { pipeline, env } = await import('@huggingface/transformers');
  const cached = existsSync(join(String(env.cacheDir), ...LOCAL_MODEL.split('/')));
  let started = performance.now();
  const extractor = await pipeline('feature-extraction', LOCAL_MODEL);
  const loadMs = Math.round(performance.now() - started);
  ctx.log(`local model loaded in ${loadMs} ms (${cached ? 'from cache' : 'downloaded'})`);

  const embedOne = async (text: string) => {
    const t = await extractor(text, { pooling: 'mean', normalize: true });
    return Array.from(t.data as Float32Array);
  };
  // Warm-up so per-text latency excludes one-time graph setup.
  await embedOne('warm up');
  const perTextMs: number[] = [];
  const vec = async (text: string) => {
    started = performance.now();
    const v = await embedOne(text);
    perTextMs.push(Math.round((performance.now() - started) * 10) / 10);
    return v;
  };
  const docVecs: number[][] = [];
  for (const d of docs) docVecs.push(await vec(d.text));
  const queryVecs: number[][] = [];
  for (const q of queries) queryVecs.push(await vec(q.text));
  const avg = perTextMs.reduce((a, b) => a + b, 0) / perTextMs.length;
  return {
    model: LOCAL_MODEL,
    dims: docVecs[0].length,
    modelWasCached: cached,
    loadMs,
    perTextMs,
    avgPerTextMs: Math.round(avg * 10) / 10,
    maxInputTokens: 256,
    docVecs,
    queryVecs,
  };
}

const check: Check = {
  name: 'embeddings',
  title: 'Embeddings: Gemini free tier vs local MiniLM',
  keys: [],
  async run(ctx) {
    const { docs, queries } = buildCorpus(ctx);
    const results: Record<string, any> = {};

    for (const [name, fn, key] of [
      ['gemini', runGemini, 'GOOGLE_GENERATIVE_AI_API_KEY'],
      ['local', runLocal, undefined],
    ] as const) {
      if (key && !ctx.env(key)) {
        results[name] = { status: 'skipped', reason: `skipped: missing key ${key}` };
        continue;
      }
      try {
        const r = await fn(ctx, docs, queries);
        const s = sanity(docs, r.docVecs, queries, r.queryVecs);
        results[name] = { status: s.every((x) => x.ok) ? 'pass' : 'partial', ...r, sanity: s };
      } catch (err) {
        results[name] = { status: 'fail', reason: errorMessage(err) };
      }
      ctx.log(`${name}: ${results[name].status}`);
    }

    // Provisional pick for the Atlas check; the final recommendation is argued in docs/SPIKE.md.
    // Local wins a tie: no key, no quota, no network at query time, and 384 dims keep M0 storage small.
    const override = process.env.SPIKE_EMBEDDER;
    const recommended =
      override && results[override]?.docVecs
        ? override
        : (['local', 'gemini'].find((n) => results[n]?.status === 'pass') ??
          ['local', 'gemini'].find((n) => results[n]?.docVecs));

    if (recommended) {
      const r = results[recommended];
      ctx.writeOutput('embeddings-vectors', {
        embedder: recommended,
        model: r.model,
        dims: r.dims,
        docs: docs.map((d, i) => ({ ...d, embedding: r.docVecs[i] })),
        queries: queries.map((q, i) => ({ ...q, embedding: r.queryVecs[i] })),
      });
    }

    const strip = ({ docVecs, queryVecs, ...rest }: any) => rest;
    const evidence = {
      corpus: docs.map(({ id, kind, text }) => ({ id, kind, text: text.slice(0, 160) })),
      gemini: strip(results.gemini),
      local: strip(results.local),
      recommendedForAtlas: recommended ?? null,
      overrideUsed: !!override,
      geminiConsoleQuota: 'TO FILL from aistudio.google.com (embedding model limits)',
    };
    const limits = [
      'all-MiniLM-L6-v2 truncates input at 256 tokens: filing chunks must stay short.',
      'Gemini embeddings on the free tier have per minute and per day request limits.',
    ];
    const statuses = [results.gemini?.status, results.local?.status];
    if (!recommended) return { status: 'fail', reason: 'Neither embedder produced vectors', evidence, limits };
    if (statuses.every((s) => s === 'pass')) return { status: 'pass', evidence, limits };
    return { status: 'partial', reason: `gemini ${statuses[0]}, local ${statuses[1]}`, evidence, limits };
  },
};

export default check;
