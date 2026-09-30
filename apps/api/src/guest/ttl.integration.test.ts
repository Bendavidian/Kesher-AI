import { randomUUID } from 'node:crypto';
import { DEMO_SOURCE_ID, GUEST_TTL_MS } from '@kesher/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { collection } from '../db/collections';
import { toIncomingItem } from '../ingest/alpaca';
import { processItem } from '../ingest/process';
import { loadRecording } from '../ingest/recordings';
import { loadModelRecording } from '../llm/recordings';
import { isScored, scoreEvent } from '../relevance/feed';
import { runSeed } from '../seed/seed';
import { recordedModels } from '../test/api';
import { MONGO_START_TIMEOUT_MS, startTestMongo, type TestMongo } from '../test/mongo';
import { createGuest } from './guest';

const HOUR_MS = 60 * 60 * 1000;

// The TTL indexes remove a guest and everything of its own (SPEC.md decision log, T24). mongod's
// TTL monitor runs every 60 seconds by default; here every second.
describe('guest expiry, on mongod with a fast TTL monitor', () => {
  let mongo: TestMongo;
  let eventId: string;

  beforeAll(async () => {
    mongo = await startTestMongo('kesher_guest_ttl_test', [
      '--setParameter',
      'ttlMonitorSleepSecs=1',
    ]);
    await runSeed(mongo.db, new Date());
    const result = await processItem(
      mongo.db,
      toIncomingItem((await loadRecording(DEMO_SOURCE_ID))!.item),
      {
        mode: 'replay',
        models: recordedModels((await loadModelRecording(DEMO_SOURCE_ID))!),
        now: () => new Date(),
        log: () => {},
      },
    );
    if (result.outcome !== 'processed') throw new Error('expected processed');
    eventId = result.eventId;
  }, MONGO_START_TIMEOUT_MS);

  afterAll(async () => {
    await mongo?.stop();
  });

  it('removes an expired guest with its items, runs, reports and claims, and nothing else', async () => {
    const { db } = mongo;
    const personaItems = await collection(db, 'feed_items').countDocuments();
    // Created 25 hours ago, so it expired an hour ago; a live guest stays.
    const old = await createGuest(db, ['NVDA'], new Date(Date.now() - GUEST_TTL_MS - HOUR_MS));
    const live = await createGuest(db, ['TSM'], new Date());
    if (old.outcome !== 'created' || live.outcome !== 'created') throw new Error('no guest');
    const expiresAt = old.user.expiresAt!;
    expect(await collection(db, 'feed_items').countDocuments({ userId: old.user._id })).toBe(1);

    // Scoring ignores a guest the monitor has not removed yet: no new item, still scored.
    expect(await isScored(db, eventId)).toBe(true);
    const scored = await scoreEvent(db, eventId);
    expect(scored.map((s) => s.item.userId)).not.toContain(old.user._id);

    const runId = randomUUID();
    const reportId = randomUUID();
    await collection(db, 'agent_runs').insertOne({
      _id: runId,
      userId: old.user._id,
      eventId,
      agent: 'research',
      mode: 'auto',
      trigger: 'gate',
      gate: { decision: 'skip', reason: 'guest' },
      stepBudget: 6,
      tokenBudget: 16_000,
      steps: [],
      tokensUsed: 0,
      verification: null,
      costUsd: 0,
      status: 'skipped',
      failureReason: null,
      startedAt: null,
      finishedAt: expiresAt,
      createdAt: expiresAt,
      expiresAt,
    });
    await collection(db, 'reports').insertOne({
      _id: reportId,
      runId,
      sections: [],
      openQuestions: [],
      omitted: [],
      createdAt: expiresAt,
      expiresAt,
    });
    await collection(db, 'claims').insertOne({
      _id: randomUUID(),
      reportId,
      origin: 'model',
      type: 'fact',
      text: 'TSMC paused some production.',
      sources: [{ sourceId: randomUUID(), quote: 'paused some production' }],
      premises: [],
      status: 'unverified',
      checks: [],
      createdAt: expiresAt,
      expiresAt,
    });

    const left = async () =>
      (
        await Promise.all([
          collection(db, 'users').countDocuments({ _id: old.user._id }),
          collection(db, 'feed_items').countDocuments({ userId: old.user._id }),
          collection(db, 'agent_runs').countDocuments({ _id: runId }),
          collection(db, 'reports').countDocuments({ _id: reportId }),
          collection(db, 'claims').countDocuments({ reportId }),
        ])
      ).reduce((sum, n) => sum + n, 0);
    await expect.poll(left, { timeout: 15_000, interval: 250 }).toBe(0);

    // The personas and the live guest stay, and the event stays scored.
    expect(await collection(db, 'users').countDocuments({ expiresAt: { $exists: false } })).toBe(3);
    expect(await collection(db, 'users').countDocuments({ _id: live.user._id })).toBe(1);
    expect(await collection(db, 'feed_items').countDocuments()).toBe(personaItems + 1);
    expect(await isScored(db, eventId)).toBe(true);
  }, 30_000);
});
