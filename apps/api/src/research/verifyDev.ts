import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { loadModelKeys } from '../config/env';
import { createModelClient, MODELS, resolveFromKeys } from '../llm/client';
import {
  loadPlantedFixture,
  PLANTED_CLAIMS,
  PLANTED_QUESTIONS,
  removedBy,
  VerifierRecording,
  verifierRecordingPath,
  verifyPlanted,
} from './planted';
import type { RecordedVerifierCall } from './recordings';

// npm run verify:dev -- [--record] [--force]
// Development only: runs the deterministic checks and the real verifier once on the report with
// planted errors (planted.ts) and prints what each claim ended as against what it should. Free
// tier calls only: one Groq call, or Gemini on a 429. --record writes the raw answers to
// recordings/verifier/planted.json for the tests, which never call a provider.

if (process.env.NODE_ENV === 'production') {
  console.error('verify:dev is a development script; it never runs in production.');
  process.exit(1);
}

const Args = z.object({ record: z.boolean().default(false), force: z.boolean().default(false) });
const { values } = parseArgs({
  options: { record: { type: 'boolean' }, force: { type: 'boolean' } },
});
const args = Args.safeParse(values);
if (!args.success) {
  console.error('Usage: npm run verify:dev -- [--record] [--force]');
  process.exit(1);
}
const { record, force } = args.data;

const path = verifierRecordingPath();
if (record && existsSync(path) && !force) {
  console.error(`${path} exists; pass --force to record it again.`);
  process.exit(1);
}

const models = createModelClient({ resolve: resolveFromKeys(loadModelKeys()) });
const calls: RecordedVerifierCall[] = [];
let answeredBy = { provider: MODELS.extraction.provider, model: MODELS.extraction.model } as {
  provider: 'groq' | 'google';
  model: string;
};
const outcome = await verifyPlanted(models, await loadPlantedFixture(), (call) => {
  if (call.ok) {
    answeredBy = { provider: call.provider, model: call.model };
    calls.push({
      text: call.text,
      usage: {
        inputTokens: call.usage.inputTokens ?? null,
        outputTokens: call.usage.outputTokens ?? null,
        totalTokens: call.usage.totalTokens ?? null,
      },
    });
    console.log(
      `Verifier call: ${call.provider} ${call.model}, ${call.tokens} tokens, ${call.claimIds.length} claims`,
    );
  } else {
    calls.push({ error: call.error });
    console.log(`Verifier call failed: ${call.error}`);
  }
});

let caught = 0;
let planted = 0;
let misses = 0;
for (const { claim, expected, why } of PLANTED_CLAIMS) {
  const final = outcome.byKey.get(claim.key);
  const got = final ? (final.status === 'removed' ? removedBy(final) : final.status) : 'dropped';
  const ok = got === expected;
  if (expected !== 'supported') {
    planted++;
    if (final?.status === 'removed') caught++;
  }
  if (!ok) misses++;
  const verdict = final?.checks.find((c) => c.name === 'verifier');
  console.log(
    `${ok ? 'ok  ' : 'MISS'} ${claim.key.padEnd(3)} ${String(got).padEnd(18)} expected ${String(expected).padEnd(18)} ${why}${verdict?.detail ? ` (verifier: ${verdict.detail})` : ''}`,
  );
}
const questionDropped = outcome.droppedQuestions.includes(PLANTED_QUESTIONS.dropped);
console.log(`${questionDropped ? 'ok  ' : 'MISS'} open question with advice dropped`);
console.log(
  `Planted errors caught: ${caught + (questionDropped ? 1 : 0)} of ${planted + 1}; claims off expectation: ${misses}`,
);

if (record) {
  const recording = VerifierRecording.parse({
    fixture: 'planted',
    recordedAt: new Date().toISOString(),
    ...answeredBy,
    calls,
  });
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(recording, null, 2)}\n`);
  console.log(`Recorded ${calls.length} verifier calls to ${path}`);
}
