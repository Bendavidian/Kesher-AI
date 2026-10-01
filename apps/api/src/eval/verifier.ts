import { CheckName, type ClaimOrigin } from '@kesher/shared';
import { createModelClient, MODELS } from '../llm/client';
import {
  loadPlantedFixture,
  loadVerifierRecording,
  PLANTED_CLAIMS,
  PLANTED_QUESTIONS,
  removedBy,
  verifyPlanted,
} from '../research/planted';
// Test doubles in a dev-only job, as in runner.ts.
import { mockModel, resolveMocks } from '../test/models';

// The verifier catch rate: the T14 report with planted errors (apps/api/src/research/planted.ts)
// through the deterministic checks and the verifier, whose answers are replayed from
// recordings/verifier/planted.json. No provider is called; the Gemini fallback has no answer.

export interface VerifierEval {
  claims: number;
  questions: number;
  // Planted errors: the claims expected to be removed, and the open question with advice
  // language, which no_advice must drop.
  planted: number;
  // Removed or dropped by the check each was planted for.
  caught: number;
  byCheck: { check: CheckName; planted: number; caught: number }[];
  // Clean claims that did not end supported.
  cleanRemoved: string[];
  // Claims that did not end as expected, clean or planted: "c5 expected quote_verbatim, got ...".
  offExpectation: string[];
  origins: Record<ClaimOrigin, number>;
  calls: number;
  tokens: number;
}

export async function plantedEval(): Promise<VerifierEval> {
  const recording = await loadVerifierRecording();
  if (!recording) {
    throw new Error(
      'recordings/verifier/planted.json is missing; run npm run verify:dev -- --record',
    );
  }
  const verifier = mockModel(
    recording.model,
    recording.calls.map((call) => ('error' in call ? new Error(call.error) : call.text)),
  );
  const fallback = mockModel(MODELS.fallback.model, [new Error('the fallback is not replayed')]);
  const models = createModelClient({
    resolve: resolveMocks({ [verifier.modelId]: verifier, [fallback.modelId]: fallback }),
  });
  const outcome = await verifyPlanted(models, await loadPlantedFixture());

  const offExpectation: string[] = [];
  const cleanRemoved: string[] = [];
  const origins: Record<ClaimOrigin, number> = { model: 0, code: 0 };
  const byCheck = new Map(CheckName.options.map((check) => [check, { planted: 0, caught: 0 }]));
  for (const { claim, expected } of PLANTED_CLAIMS) {
    const final = outcome.byKey.get(claim.key);
    if (final) origins[final.origin] += 1;
    const got = !final ? 'missing' : final.status === 'removed' ? removedBy(final) : final.status;
    if (expected === 'supported') {
      if (got !== 'supported') cleanRemoved.push(claim.key);
    } else {
      const count = byCheck.get(expected)!;
      count.planted += 1;
      if (got === expected) count.caught += 1;
    }
    if (got !== expected) offExpectation.push(`${claim.key} expected ${expected}, got ${got}`);
  }
  // The open question with advice language is planted for no_advice too.
  const advice = byCheck.get('no_advice')!;
  advice.planted += 1;
  if (outcome.droppedQuestions.includes(PLANTED_QUESTIONS.dropped)) advice.caught += 1;
  else offExpectation.push('the advice question was not dropped');

  const checks = [...byCheck].map(([check, count]) => ({ check, ...count }));
  return {
    claims: PLANTED_CLAIMS.length,
    questions: Object.keys(PLANTED_QUESTIONS).length,
    planted: checks.reduce((n, c) => n + c.planted, 0),
    caught: checks.reduce((n, c) => n + c.caught, 0),
    byCheck: checks.filter((c) => c.planted > 0),
    cleanRemoved,
    offExpectation,
    origins,
    calls: recording.calls.length,
    tokens: recording.calls.reduce(
      (n, call) => n + ('usage' in call ? (call.usage.totalTokens ?? 0) : 0),
      0,
    ),
  };
}
