import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  AgentRun,
  Claim,
  Report,
  type FeedItem,
  type MarketEvent,
  type PriceReaction,
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
import { reviveReaction } from '../market/fixture';
import type { PriceReactions } from '../market/reactions';
import { COMPANIES, DEMO_SOURCE_ID, EDGES, FILINGS, PERSONAS } from '../seed/config';
import { oneHot } from '../test/embedder';
import { mockModel, resolveMocks } from '../test/models';
import { MONGO_START_TIMEOUT_MS, startTestMongo, type TestMongo } from '../test/mongo';
import { memorySearch } from '../test/search';
import { runResearch } from './agent';
import { ReportDraft } from './draft';
import { loadResearchRecording, type ResearchRecording } from './recordings';

const SECRET = 'replay-secret-that-is-long-enough!!';

// The real research run on the demo item (npm run research:dev -- --record), replayed through
// mock models against a real MCP server. The item is stored under the Atlas ids the run used, so
// the recorded tool calls and cited source ids resolve. No provider is called.
const seededEdge = () => {
  const edge = EDGES.find((e) => e.from === 'TSM' && e.to === 'NVDA');
  if (!edge) throw new Error('no seeded TSM supplier_of NVDA edge');
  return edge;
};

describe('research replay of the demo item', () => {
  let mongo: TestMongo;
  let server: Server;
  let mcpUrl: string;
  let recording: ResearchRecording;
  let user: User;
  let source: Source;
  let filing: Source;
  // The price reaction the recorded run read, for get_price_reaction and numbers_match alike.
  let reaction: PriceReaction;
  const priceReactions: PriceReactions = () => Promise.resolve(reaction);

  beforeAll(async () => {
    const recorded = await loadResearchRecording(DEMO_SOURCE_ID);
    const alpaca = await loadRecording(DEMO_SOURCE_ID);
    const models = await loadModelRecording(DEMO_SOURCE_ID);
    if (!recorded || !alpaca || !models) throw new Error('the demo recordings are missing');
    recording = recorded;
    reaction = reviveReaction(recording.reaction);

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
    // Persona A's path through the seeded TSM supplier_of NVDA edge, under the Atlas ids the run
    // used, so the code fact cites the same filing Source the recorded claims do.
    const [hop] = recording.ids.path ?? [];
    const edge = seededEdge();
    const nvidia = COMPANIES.find((c) => c.symbol === 'NVDA');
    if (!hop || !nvidia) throw new Error('the recording has no path edge');
    filing = { ...FILINGS.NVDA.source, _id: hop.filingSourceId, createdAt: new Date() };
    // What search_filings returned in the run, as far as the report quotes it: a chunk of the
    // NVIDIA 10-K for each quote the model's claims took from that filing.
    const reportCall = recording.turns
      .flatMap((turn) => turn.toolCalls)
      .find((call) => call.toolName === 'submit_report');
    const draft = ReportDraft.parse(JSON.parse(reportCall?.input ?? '{}'));
    const filingQuotes = [
      ...new Set(
        draft.claims.flatMap((claim) =>
          claim.sources.flatMap((s) => (s.sourceId === filing._id && s.quote ? [s.quote] : [])),
        ),
      ),
    ];
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
            relationshipId: hop.relationshipId,
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
    await collection(mongo.db, 'sources').insertMany([source, filing]);
    await collection(mongo.db, 'companies').insertOne({
      ...nvidia,
      _id: randomUUID(),
      createdAt: new Date(),
    });
    await collection(mongo.db, 'relationships').insertOne({
      _id: hop.relationshipId,
      from: edge.from,
      to: edge.to,
      type: edge.type,
      weight: 0.8,
      evidence: {
        sourceId: filing._id,
        quote: edge.quote,
        filingDate: FILINGS.NVDA.filingDate,
        url: filing.url,
        reviewed: true,
      },
      createdAt: new Date(),
    });
    if (filingQuotes.length > 0) {
      await collection(mongo.db, 'filing_chunks').insertMany(
        filingQuotes.map((text, chunkIndex) => ({
          _id: randomUUID(),
          sourceId: filing._id,
          symbol: 'NVDA' as const,
          form: '10-K' as const,
          section: 'Item 1A. Risk Factors',
          chunkIndex,
          text,
          embedding: oneHot(text),
          createdAt: new Date(),
        })),
      );
    }
    await collection(mongo.db, 'market_events').insertOne(event);
    await collection(mongo.db, 'feed_items').insertOne(item);
    server = createApp({
      db: mongo.db,
      devRoutes: false,
      mcp: { secret: SECRET },
      search: memorySearch(mongo.db),
      priceReactions,
    }).listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    mcpUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
  }, MONGO_START_TIMEOUT_MS);

  afterAll(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    await mongo?.stop();
  });

  it('returns a verified report that opens with the code claims: the 10-K fact and the price metric', async () => {
    const gemini = mockModel(
      recording.model,
      recording.turns.map((turn) => ({
        text: turn.text,
        toolCalls: turn.toolCalls,
        usage: { input: turn.usage.inputTokens ?? 0, output: turn.usage.outputTokens ?? 0 },
      })),
    );
    // Groq answers only the verifier, with its recorded answers.
    const verifier = recording.verifier ?? [];
    const groq = mockModel(
      MODELS.extraction.model,
      verifier.map((call) => ('error' in call ? new Error(call.error) : call.text)),
    );
    const models = createModelClient({
      resolve: resolveMocks({ [gemini.modelId]: gemini, [groq.modelId]: groq }),
    });

    const outcome = await runResearch(
      {
        db: mongo.db,
        models,
        mcp: { url: mcpUrl, secret: SECRET },
        redact: (text) => text,
        priceReactions,
      },
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
    const modelSteps = run.steps.flatMap((s) =>
      s.kind === 'model' && s.name !== 'Verifier' ? [s] : [],
    );
    expect(modelSteps.map((s) => s.tokens.total)).toEqual(
      recording.turns.map((t) => t.usage.totalTokens),
    );
    expect(modelSteps.every((s) => s.provider === recording.provider)).toBe(true);
    // Every recorded tool call ran through MCP, the price reaction included.
    expect(run.steps.filter((s) => s.kind === 'tool').map((s) => s.name)).toEqual(
      recording.turns.flatMap((t) =>
        t.toolCalls.map((c) => c.toolName).filter((name) => name !== 'submit_report'),
      ),
    );
    expect(run.steps.map((s) => s.name)).toContain('get_price_reaction');
    // One verifier call, on its own cap, never on the research budget.
    expect(verifier).toHaveLength(1);
    expect(groq.doGenerateCalls).toHaveLength(1);
    expect(run.tokensUsed).toBe(
      recording.turns.reduce((sum, t) => sum + (t.usage.totalTokens ?? 0), 0),
    );
    expect(run.verification?.tokensUsed).toBeGreaterThan(0);

    const report = Report.parse(await collection(mongo.db, 'reports').findOne({ runId: run._id }));
    const claims = (
      await collection(mongo.db, 'claims').find({ reportId: report._id }).toArray()
    ).map((c) => Claim.parse(c));
    expect(report.omitted).toEqual([]);
    // Code's claims come first: the path's 10-K fact and the price metric, both supported.
    const [pathFact, priceMetric, ...modelClaims] = claims;
    expect(pathFact).toMatchObject({
      origin: 'code',
      type: 'fact',
      text: "TSMC supplies NVIDIA, according to NVIDIA's 10-K.",
      status: 'supported',
      sources: [{ sourceId: filing._id, quote: seededEdge().quote }],
    });
    expect(priceMetric).toMatchObject({
      origin: 'code',
      type: 'metric',
      text: 'TSM opened −1.16% below its previous close and NVDA opened −1.07% below its previous close; SMH −1.00%, SPY −0.22%.',
      status: 'supported',
    });
    // Then the model's, as recorded: every claim passed every check, the verifier included.
    expect(modelClaims.every((c) => c.origin === 'model')).toBe(true);
    expect(new Set(modelClaims.map((c) => c.type))).toEqual(
      new Set(['fact', 'metric', 'inference']),
    );
    for (const claim of claims) {
      expect(claim.status).toBe('supported');
      expect(claim.checks.every((c) => c.passed)).toBe(true);
      expect(claim.checks.map((c) => c.name)).toContain('verifier');
    }
    for (const fact of claims.filter((c) => c.type === 'fact')) {
      expect(fact.checks).toContainEqual({ name: 'quote_verbatim', passed: true, detail: null });
    }
    for (const metric of claims.filter((c) => c.type === 'metric')) {
      expect(metric.checks).toContainEqual({ name: 'numbers_match', passed: true, detail: null });
      // Code appends the market data after any source the model cited.
      const market = metric.sources.at(-1);
      expect(
        await collection(mongo.db, 'sources').findOne({ _id: market?.sourceId ?? '' }),
      ).toMatchObject({ kind: 'market_data', text: null });
    }
    for (const call of gemini.doGenerateCalls) {
      expect(JSON.stringify(call.prompt)).not.toContain(user._id);
    }
  });
});
