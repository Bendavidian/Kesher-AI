import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  AgentRun,
  Claim,
  Report,
  type FeedItem,
  type MarketEvent,
  type Source,
  type User,
} from '@kesher/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { collection } from '../db/collections';
import { ensureCollections, ensureIndexes } from '../db/indexes';
import { ExtractionOutput, toExtraction } from '../extract/extraction';
import { toIncomingItem } from '../ingest/alpaca';
import { loadRecording } from '../ingest/recordings';
import { createModelClient, MODELS } from '../llm/client';
import { loadModelRecording } from '../llm/recordings';
import { DEMO_SOURCE_ID, PERSONAS } from '../seed/config';
import { mockModel, resolveMocks } from '../test/models';
import { MONGO_START_TIMEOUT_MS, startTestMongo, type TestMongo } from '../test/mongo';
import { runResearch } from './agent';
import { loadResearchRecording, type ResearchRecording } from './recordings';

const SECRET = 'replay-secret-that-is-long-enough!!';

// The real research run on the demo item (npm run research:dev -- --record), replayed through
// mock models against a real MCP server. The item is stored under the Atlas ids the run used, so
// the recorded tool calls and cited source ids resolve. No provider is called.
describe('research replay of the demo item', () => {
  let mongo: TestMongo;
  let server: Server;
  let mcpUrl: string;
  let recording: ResearchRecording;
  let user: User;
  let source: Source;

  beforeAll(async () => {
    const recorded = await loadResearchRecording(DEMO_SOURCE_ID);
    const alpaca = await loadRecording(DEMO_SOURCE_ID);
    const models = await loadModelRecording(DEMO_SOURCE_ID);
    if (!recorded || !alpaca || !models) throw new Error('the demo recordings are missing');
    recording = recorded;

    const persona = PERSONAS[0];
    if (!persona) throw new Error('no persona A');
    user = { _id: randomUUID(), passwordHash: 'scrypt$test', createdAt: new Date(), ...persona };
    const [sourceId] = recording.ids.sourceIds;
    source = {
      ...toIncomingItem(alpaca.item),
      _id: sourceId ?? '',
      injectionScreen: null,
      createdAt: new Date(),
    };
    const extraction = toExtraction(ExtractionOutput.parse(JSON.parse(models.extraction.text)), {
      provider: models.extraction.provider,
      model: models.extraction.model,
      extractedAt: new Date(),
    });
    const event: MarketEvent = {
      _id: recording.ids.eventId,
      sourceIds: recording.ids.sourceIds,
      headline: source.title,
      publishedAt: source.publishedAt,
      status: 'unconfirmed',
      extraction,
      embedding: null,
      createdAt: new Date(),
    };
    // Persona A's path as scoring stores it. The agent reads only the path, never the edge, so
    // the relationship id is synthetic and no edge is stored here.
    const item: FeedItem = {
      _id: randomUUID(),
      userId: user._id,
      eventId: event._id,
      relevance: 0.8,
      path: {
        eventCompany: 'TSM',
        holding: 'NVDA',
        hops: [
          {
            from: 'TSM',
            to: 'NVDA',
            type: 'supplier_of',
            weight: 0.8,
            relationshipId: randomUUID(),
          },
        ],
      },
      confidence: 'medium',
      status: 'unconfirmed',
      research: { state: 'none', runId: null, reportId: null },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    mongo = await startTestMongo('kesher_research_replay_test');
    await ensureCollections(mongo.db);
    await ensureIndexes(mongo.db);
    await collection(mongo.db, 'users').insertOne(user);
    await collection(mongo.db, 'sources').insertOne(source);
    await collection(mongo.db, 'market_events').insertOne(event);
    await collection(mongo.db, 'feed_items').insertOne(item);
    server = createApp({ db: mongo.db, devRoutes: false, mcp: { secret: SECRET } }).listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    mcpUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
  }, MONGO_START_TIMEOUT_MS);

  afterAll(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    await mongo?.stop();
  });

  it('returns a report in which every fact has a source id and a verified quote', async () => {
    const gemini = mockModel(
      recording.model,
      recording.turns.map((turn) => ({
        text: turn.text,
        toolCalls: turn.toolCalls,
        usage: { input: turn.usage.inputTokens ?? 0, output: turn.usage.outputTokens ?? 0 },
      })),
    );
    const groq = mockModel(MODELS.researchFallback.model, [new Error('Groq is not used')]);
    const models = createModelClient({
      resolve: resolveMocks({ [gemini.modelId]: gemini, [groq.modelId]: groq }),
    });

    const outcome = await runResearch(
      { db: mongo.db, models, mcp: { url: mcpUrl, secret: SECRET }, redact: (text) => text },
      {
        userId: user._id,
        eventId: recording.ids.eventId,
        mode: recording.mode,
        trigger: 'investigate',
        gateReason: 'Replay of the recorded research run.',
      },
    );

    expect(outcome.status).toBe('succeeded');
    const run = AgentRun.parse(
      await collection(mongo.db, 'agent_runs').findOne({ _id: outcome.runId }),
    );
    const modelSteps = run.steps.filter((s) => s.kind === 'model');
    expect(modelSteps.map((s) => s.tokens.total)).toEqual(
      recording.turns.map((t) => t.usage.totalTokens),
    );
    expect(modelSteps.every((s) => s.provider === recording.provider)).toBe(true);
    expect(run.steps.filter((s) => s.kind === 'tool').map((s) => s.name)).toEqual([
      'get_event',
      'search_news',
    ]);
    expect(groq.doGenerateCalls).toHaveLength(0);

    const report = Report.parse(await collection(mongo.db, 'reports').findOne({ runId: run._id }));
    const claims = (
      await collection(mongo.db, 'claims').find({ reportId: report._id }).toArray()
    ).map((c) => Claim.parse(c));
    const facts = claims.filter((c) => c.type === 'fact');
    expect(facts.length).toBeGreaterThan(0);
    for (const fact of facts) {
      expect(fact.status).toBe('unverified');
      expect(fact.sources.every((s) => s.sourceId === source._id && s.quote !== null)).toBe(true);
      expect(fact.checks).toContainEqual({ name: 'quote_verbatim', passed: true, detail: null });
    }
    expect(claims.every((c) => c.status !== 'removed')).toBe(true);
    for (const call of gemini.doGenerateCalls) {
      expect(JSON.stringify(call.prompt)).not.toContain(user._id);
    }
  });
});
