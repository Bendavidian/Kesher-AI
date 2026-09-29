import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadCandidates, loadReviews } from '../graph/review';
import type { ModelRecording } from '../llm/recordings';
import { MONGO_START_TIMEOUT_MS, startTestMongo, type TestMongo } from '../test/mongo';
import { loadEvents, loadPoisoned } from './dataset';
import { loadEvalItems, loadModelsOf, type EvalItem } from './items';
import { loadLabels } from './labels';
import { renderReport } from './report';
import { runEval, type EvalRun } from './runner';
import { edgeExtractor, summarizeRun } from './summary';

// npm run eval as CI runs it: every committed recording replayed through the whole pipeline in a
// fresh database, with no provider call.

const now = new Date('2026-09-29T12:00:00.000Z');

// The numbers that must not depend on timing.
const stable = (run: EvalRun) =>
  run.items.map((r) => ({
    id: r.item.id,
    outcome: r.outcome.outcome,
    relevance: r.relevance,
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

  it('processes all 30 items and the 5 poisoned ones from recordings alone', () => {
    expect(run.items.filter((r) => r.item.kind === 'real')).toHaveLength(30);
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
  });

  it('keeps persona A at 0 on the KO item whose text names NVDA', () => {
    const poisoned = run.items.find((r) => r.item.id === '9000000002')!;
    const baseline = run.items.find((r) => r.item.id === '42456879')!;
    expect(poisoned.tagged).toEqual(['KO']);
    expect(poisoned.relevance.A).toBe(0);
    expect(poisoned.relevance).toEqual(baseline.relevance);
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
    const reviewed = labels.filter((l) => l.status === 'reviewed').length;
    expect(summary.labels).toEqual({ reviewed, proposed: labels.length - reviewed });
    const counted = (['A', 'B', 'C'] as const).reduce(
      (sum, p) => sum + summary.agreement[p].reviewed.total,
      0,
    );
    expect(counted).toBe(reviewed);
    expect(summary.injection).toHaveLength(5);
    expect(summary.edges).toMatchObject({ relationships: 28, accepted: 22 });

    const report = renderReport(summary, { status: 'skipped', reason: 'no Atlas in this test' });
    for (const heading of [
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
