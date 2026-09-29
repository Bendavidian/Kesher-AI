import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { AgentRun, Claim, Report } from '@kesher/shared';
import { z } from 'zod';
import { createApp } from '../app';
import { loadAlpacaKeys, loadEnv, loadMcpEnv, loadModelKeys } from '../config/env';
import { describeError, redactor } from '../config/redact';
import { collection } from '../db/collections';
import { DB_NAME, connect } from '../db/client';
import { lazyLocalEmbedder } from '../embed/local';
import { createModelClient, resolveFromKeys } from '../llm/client';
import { createMarketData } from '../market/data';
import { createPriceReactions } from '../market/reactions';
import { DEMO_SOURCE_ID, DEMO_SOURCE_PROVIDER, PERSONAS } from '../seed/config';
import { runResearch } from './agent';
import { ResearchRecording, researchRecordingPath, type RecordedTurn } from './recordings';

// npm run research:dev -- [--mode deep|auto] [--record] [--force]
// Development only: runs the research agent once for persona A on the demo event against Atlas,
// through a real MCP server on 127.0.0.1, and prints the run. It mints the run token itself,
// standing in for the auth context of POST /events/:eventId/investigate (T08 part 2). Nothing in
// the api imports this file, and it refuses to run in production. Free tier calls only.
// --record writes the raw model turns to recordings/research/<alpaca id>.json for the tests.

if (process.env.NODE_ENV === 'production') {
  console.error('research:dev is a development script; it never runs in production.');
  process.exit(1);
}

const Args = z.object({
  mode: z.enum(['auto', 'deep']).default('deep'),
  record: z.boolean().default(false),
  force: z.boolean().default(false),
});
const { values } = parseArgs({
  options: { mode: { type: 'string' }, record: { type: 'boolean' }, force: { type: 'boolean' } },
});
const args = Args.safeParse(values);
if (!args.success) {
  console.error('Usage: npm run research:dev -- [--mode deep|auto] [--record] [--force]');
  process.exit(1);
}
const { mode, record, force } = args.data;

const env = loadEnv();
if (env.NODE_ENV === 'production') {
  console.error('research:dev is a development script; it never runs in production.');
  process.exit(1);
}
const { MCP_TOKEN_SECRET } = loadMcpEnv();
const keys = loadModelKeys();
const alpacaKeys = loadAlpacaKeys();
const redact = redactor(env.MONGODB_URI, [
  MCP_TOKEN_SECRET,
  keys.groq ?? '',
  keys.google ?? '',
  alpacaKeys?.keyId ?? '',
  alpacaKeys?.secretKey ?? '',
]);

const recordingPath = researchRecordingPath(DEMO_SOURCE_ID);
if (record && existsSync(recordingPath) && !force) {
  console.error(`${recordingPath} exists; pass --force to record it again.`);
  process.exit(1);
}

const persona = PERSONAS[0];
if (!persona) throw new Error('no persona A in the seed config');

const client = await connect(env.MONGODB_URI).catch((error: unknown) => {
  console.error(redact(`Could not connect to MongoDB: ${describeError(error)}`));
  process.exit(1);
});
const db = client.db(DB_NAME);
const server = createApp({
  db,
  devRoutes: false,
  mcp: { secret: MCP_TOKEN_SECRET },
  logError: (error) => console.error(redact(describeError(error))),
  // The same market data and local embedding model as the api, so every tool works here.
  priceReactions: createPriceReactions(createMarketData({ keys: () => alpacaKeys })),
  embedder: lazyLocalEmbedder(),
}).listen(0, '127.0.0.1');

try {
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;

  const source = await collection(db, 'sources').findOne({
    provider: DEMO_SOURCE_PROVIDER,
    externalId: DEMO_SOURCE_ID,
  });
  const event =
    source && (await collection(db, 'market_events').findOne({ sourceIds: source._id }));
  const user = await collection(db, 'users').findOne({ email: persona.email });
  if (!source || !event || !user) {
    throw new Error('the demo event or persona A is missing; run npm run seed and replay 38062166');
  }

  const turns: RecordedTurn[] = [];
  const models = createModelClient({ resolve: resolveFromKeys(keys) });
  const outcome = await runResearch(
    { db, models, mcp: { url, secret: MCP_TOKEN_SECRET }, redact, onTurn: (t) => turns.push(t) },
    {
      userId: user._id,
      eventId: event._id,
      mode,
      trigger: 'investigate',
      gateReason:
        'Investigate from npm run research:dev skips the relevance and importance conditions; the daily budget lands in T12.',
    },
  );

  const run = AgentRun.parse(await collection(db, 'agent_runs').findOne({ _id: outcome.runId }));
  const print = (line: string) => console.log(redact(line));
  print(`Run ${run._id}: ${run.status}${run.failureReason ? ` (${run.failureReason})` : ''}`);
  print(`Mode ${run.mode}, ${run.tokensUsed} of ${run.tokenBudget} tokens`);
  print('');
  print('Steps:');
  for (const step of run.steps) {
    const tokens =
      step.kind === 'model'
        ? `  ${step.provider} ${step.model}, in ${step.tokens.input}, out ${step.tokens.output}, total ${step.tokens.total}`
        : '';
    print(`- ${step.kind} ${step.name} (${Math.round(step.latencyMs)} ms)${tokens}`);
    if (step.kind === 'tool') print(`    input ${JSON.stringify(step.input)}`);
    print(`    ${step.outputSummary}`);
  }

  if (outcome.reportId) {
    const report = Report.parse(await collection(db, 'reports').findOne({ _id: outcome.reportId }));
    const claims = (await collection(db, 'claims').find({ reportId: report._id }).toArray()).map(
      (c) => Claim.parse(c),
    );
    print('');
    print('Claims:');
    for (const claim of claims) {
      print(`- [${claim.type}, ${claim.status}] ${claim.text}`);
      for (const s of claim.sources) print(`    source ${s.sourceId}: ${s.quote ?? '(no quote)'}`);
      for (const check of claim.checks) {
        print(`    ${check.name}: ${check.passed ? 'passed' : `failed, ${check.detail ?? ''}`}`);
      }
    }
    print('');
    print('Open questions:');
    for (const question of report.openQuestions) print(`- ${question}`);
  }

  if (record) {
    if (outcome.status !== 'succeeded') {
      console.error(`Not recorded: the run ended as ${outcome.status}.`);
      process.exitCode = 1;
    } else {
      const recording = ResearchRecording.parse({
        externalId: DEMO_SOURCE_ID,
        recordedAt: new Date().toISOString(),
        persona: 'A',
        mode,
        provider: run.steps.find((s) => s.kind === 'model')?.provider,
        model: run.steps.find((s) => s.kind === 'model')?.model,
        ids: { eventId: event._id, sourceIds: event.sourceIds },
        turns,
      });
      await mkdir(dirname(recordingPath), { recursive: true });
      await writeFile(recordingPath, `${JSON.stringify(recording, null, 2)}\n`);
      print(`\nRecorded ${turns.length} model turns to ${recordingPath}`);
    }
  }
} catch (error) {
  console.error(redact(describeError(error)));
  process.exitCode = 1;
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await client.close();
}
