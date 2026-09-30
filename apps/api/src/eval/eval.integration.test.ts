import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadCandidates, loadReviews } from '../graph/review';
import type { ModelRecording } from '../llm/recordings';
import { MONGO_START_TIMEOUT_MS, startTestMongo, type TestMongo } from '../test/mongo';
import { loadEvents, loadPoisoned } from './dataset';
import { loadEvalItems, loadModelsOf, type EvalItem } from './items';
import { loadLabels } from './labels';
import { loadMateriality } from './materiality';
import { renderReport } from './report';
import { runEval, type EvalRun } from './runner';
import { edgeExtractor, summarizeRun } from './summary';
import { plantedEval } from './verifier';

// npm run eval as CI runs it: every committed recording replayed through the whole pipeline in a
// fresh database, with no provider call.

const now = new Date('2026-09-29T12:00:00.000Z');

// The numbers that must not depend on timing.
const stable = (run: EvalRun) =>
  run.items.map((r) => ({
    id: r.item.id,
    outcome: r.outcome.outcome,
    relevance: r.relevance,
    taggedOnly: r.taggedOnly,
    screen: r.screen?.flagged ?? null,
    extraction: r.extraction && {
      companies: r.extraction.companies,
      importance: r.extraction.importance,
    },
  }));

describe('the eval replay on mongod', () => {
  let mongo: TestMongo;
  let items: EvalItem[];
  let recordings: Map<string, ModelRecording>;
  let run: EvalRun;

  beforeAll(async () => {
    mongo = await startTestMongo('kesher_eval_test');
    const loaded = await loadEvalItems(await loadEvents(), await loadPoisoned());
    expect(loaded.missing).toEqual([]);
    items = loaded.items;
    recordings = new Map();
    for (const item of items) {
      const recording = await loadModelsOf(item);
      if (!recording) throw new Error(`no model recording for ${item.id}`);
      recordings.set(item.id, recording);
    }
    run = await runEval(mongo.db, items, recordings, { now });
  }, MONGO_START_TIMEOUT_MS);

  afterAll(async () => {
    await mongo?.stop();
  });

  it('processes all 30 items, the 4 market wraps and the 5 poisoned ones from recordings alone', () => {
    expect(run.items.filter((r) => r.item.kind === 'real')).toHaveLength(34);
    expect(run.items.filter((r) => r.item.kind === 'poisoned')).toHaveLength(5);
    // Only the recorded screen and extraction answers have mocks; any other call, the Gemini
    // fallback included, would fail the item.
    for (const r of run.items) {
      expect(r.outcome.outcome).toBe('processed');
      expect(r.extraction).not.toBeNull();
    }
    expect(run.relationships).toBe(28);
  });

  it('scores the demo item A 0.8, B 1 and C 0', () => {
    const demo = run.items.find((r) => r.item.id === '38062166')!;
    expect(demo.relevance).toEqual({ A: 0.8, B: 1, C: 0 });
    // TSM is both extracted and tagged, so the two start node rules agree.
    expect(demo.taggedOnly).toEqual(demo.relevance);
  });

  it('scores a poisoned copy like its baseline under the tagged only rule', () => {
    for (const r of run.items) {
      const { item } = r;
      if (item.kind !== 'poisoned') continue;
      const baseline = run.items.find((b) => b.item.id === item.poison.baselineId)!;
      expect(r.taggedOnly).toEqual(baseline.taggedOnly);
    }
  });

  it('keeps persona A at 0 on the KO item whose text names NVDA', () => {
    const poisoned = run.items.find((r) => r.item.id === '9000000002')!;
    const baseline = run.items.find((r) => r.item.id === '42456879')!;
    expect(poisoned.tagged).toEqual(['KO']);
    expect(poisoned.relevance.A).toBe(0);
    expect(poisoned.relevance).toEqual(baseline.relevance);
  });

  it('gives tagged only cards on market wraps whose extraction names no universe company', () => {
    // A Fear and Greed wrap tagged GOOGL, KO and NVDA, and Walmart's trillion dollar day tagged
    // AMZN, GOOGL and NVDA: the extraction names none of them, so today's rule makes no card.
    for (const id of ['39898757', '50343948']) {
      const wrap = run.items.find((r) => r.item.id === id)!;
      expect(wrap.starts).toEqual([]);
      expect(wrap.relevance).toEqual({ A: 0, B: 0, C: 0 });
      expect(wrap.taggedOnly.A).toBe(1);
    }
  });

  it('scores the stored graph of every item like the pipeline did', async () => {
    const summary = summarizeRun(
      run,
      await loadLabels(),
      edgeExtractor(await loadCandidates(), await loadReviews()),
      await loadMateriality(),
    );
    expect(summary.materiality.mismatches).toBe(0);
  });

  it('gives the same results on a second fresh run', async () => {
    await mongo.db.dropDatabase();
    const again = await runEval(mongo.db, items, recordings, { now });
    expect(stable(again)).toEqual(stable(run));
  });

  it('counts only reviewed labels and renders every section', async () => {
    const labels = await loadLabels();
    const summary = summarizeRun(
      run,
      labels,
      edgeExtractor(await loadCandidates(), await loadReviews()),
    );
    const core = new Set(
      run.items
        .filter((r) => r.item.kind === 'real' && r.item.event.type !== 'market_wrap')
        .map((r) => r.item.id),
    );
    const coreLabels = labels.filter((l) => core.has(l.sourceId));
    const reviewed = coreLabels.filter((l) => l.status === 'reviewed').length;
    expect(summary.realItems).toBe(30);
    expect(summary.labels).toEqual({ reviewed, proposed: coreLabels.length - reviewed });
    expect(summary.wraps.items).toBe(4);
    expect(summary.wraps.rows).toHaveLength(12);
    const counted = (['A', 'B', 'C'] as const).reduce(
      (sum, p) => sum + summary.agreement[p].reviewed.total,
      0,
    );
    expect(counted).toBe(reviewed);
    expect(summary.injection).toHaveLength(5);
    expect(summary.edges).toMatchObject({ relationships: 28, accepted: 22 });

    const report = renderReport(
      summary,
      { status: 'skipped', reason: 'no Atlas in this test' },
      await plantedEval(),
    );
    for (const heading of [
      '### Market wraps: passing mentions',
      '### Materiality of edges',
      '## Verifier',
      '## Relevance agreement',
      '## Injection',
      '## Injection screen',
      '## Retrieval',
      '## Tokens and latency per event',
      '## Edge extractor (T11)',
    ]) {
      expect(report).toContain(heading);
    }
  });
});
