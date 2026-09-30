import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEMO_SOURCE_ID } from '@kesher/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadModelRecording } from '../llm/recordings';
import { loadReactionFixture } from '../market/fixture';
import { runSeed } from '../seed/seed';
import { recordedModels, startApi, type TestApi } from '../test/api';
import { MONGO_START_TIMEOUT_MS, startTestMongo, type TestMongo } from '../test/mongo';
import { passed, runSmoke, type CheckResult } from './smoke';

// The smoke test against the api as it runs in production: the web build served on the same
// origin, the api under /api, no dev routes, demo mode on.
describe('npm run smoke against a production-mode api, on mongod', () => {
  let mongo: TestMongo;
  let dist: string;
  let api: TestApi;
  let broken: TestApi;

  beforeAll(async () => {
    mongo = await startTestMongo('kesher_smoke_test');
    await runSeed(mongo.db, new Date('2026-09-30T12:00:00Z'));
    dist = mkdtempSync(join(tmpdir(), 'kesher-smoke-web-'));
    writeFileSync(join(dist, 'index.html'), '<!doctype html><div id="root"></div>');
    const models = recordedModels((await loadModelRecording(DEMO_SOURCE_ID))!);
    const { reaction } = await loadReactionFixture(DEMO_SOURCE_ID);
    api = await startApi(mongo.db, {
      models,
      devRoutes: false,
      demo: { cooldownMs: 0 },
      web: dist,
      priceReactions: () => Promise.resolve(reaction),
      // POST /mcp and the research routes, as server.ts mounts them; no automatic runs here.
      research: true,
      autoResearch: false,
    });
    // Demo mode off and no market data: what a host with DEMO_MODE unset would run.
    broken = await startApi(mongo.db, { models, devRoutes: false, web: dist });
  }, MONGO_START_TIMEOUT_MS);

  afterAll(async () => {
    await api?.close();
    await broken?.close();
    await mongo?.stop();
    if (dist) rmSync(dist, { recursive: true, force: true });
  });

  it('passes every check up to Investigate, which --no-investigate skips', async () => {
    const results = await runSmoke(`${api.url}/`, { investigate: false });
    const byName = (name: string) => results.find((r) => r.name === name);

    expect(results.map((r) => [r.name, r.status])).toEqual([
      ['health', 'pass'],
      ['web shell', 'pass'],
      ['routes closed', 'pass'],
      ['sign in and sockets', 'pass'],
      ['demo replay', 'pass'],
      ['live pushes', 'pass'],
      ['persona levels', 'pass'],
      ['price reaction', 'pass'],
      ['investigate', 'skip'],
    ]);
    expect(byName('persona levels')?.detail).toBe('A Medium 0.80, B High 1.00, C None 0.00');
    expect(passed(results)).toBe(true);
  });

  it('passes a second time, resetting the event it replayed before', async () => {
    const results = await runSmoke(api.url, { investigate: false });
    expect(results.find((r) => r.name === 'demo replay')?.detail).toMatch(
      /^processed, 3 FeedItems reset/,
    );
    expect(passed(results)).toBe(true);
  });

  it('fails, naming DEMO_MODE, when demo mode is off', async () => {
    const logged: CheckResult[] = [];
    const results = await runSmoke(broken.url, {
      investigate: false,
      log: (result) => logged.push(result),
    });
    expect(results[0]).toMatchObject({ name: 'health', status: 'fail' });
    expect(results[0]?.detail).toMatch(/DEMO_MODE=true/);
    expect(logged).toEqual(results);
    expect(passed(results)).toBe(false);
  });
});
