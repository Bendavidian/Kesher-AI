import { describe, expect, it } from 'vitest';
import { createModelClient, MODELS } from '../llm/client';
import { mockModel, resolveMocks } from '../test/models';
import {
  loadPlantedFixture,
  loadVerifierRecording,
  PLANTED_CLAIMS,
  PLANTED_QUESTIONS,
  removedBy,
  verifyPlanted,
} from './planted';

// The done criterion of T14: every planted error in a fixture report is caught, by the check it
// was planted for, and the clean claims end supported. The verifier's answers are the real ones
// recorded by npm run verify:dev -- --record; no provider is called.
describe('the report with planted errors', async () => {
  const recording = await loadVerifierRecording();
  if (!recording)
    throw new Error(
      'recordings/verifier/planted.json is missing; run npm run verify:dev -- --record',
    );
  const fixture = await loadPlantedFixture();

  async function run() {
    const verifier = mockModel(
      recording!.model,
      recording!.calls.map((call) => ('error' in call ? new Error(call.error) : call.text)),
    );
    // A 429 never happens in the replay; Gemini would only be the fallback.
    const fallback = mockModel(MODELS.fallback.model, [new Error('the fallback is not used')]);
    const models = createModelClient({
      resolve: resolveMocks({ [verifier.modelId]: verifier, [fallback.modelId]: fallback }),
    });
    return { outcome: await verifyPlanted(models, fixture), verifier };
  }

  it('replays one real verifier call', async () => {
    const { verifier } = await run();
    expect(recording.calls).toHaveLength(1);
    expect(verifier.doGenerateCalls).toHaveLength(1);
  });

  it.each(PLANTED_CLAIMS.filter((p) => p.expected !== 'supported'))(
    'catches $claim.key, $why, with $expected',
    async ({ claim, expected }) => {
      const { outcome } = await run();
      const final = outcome.byKey.get(claim.key);
      expect(final?.status).toBe('removed');
      expect(removedBy(final!)).toBe(expected);
    },
  );

  it.each(PLANTED_CLAIMS.filter((p) => p.expected === 'supported'))(
    'supports the clean claim $claim.key, $why',
    async ({ claim }) => {
      const { outcome } = await run();
      const final = outcome.byKey.get(claim.key);
      expect(final?.status).toBe('supported');
      expect(final?.checks.every((c) => c.passed)).toBe(true);
      expect(final?.checks.map((c) => c.name)).toContain('verifier');
    },
  );

  it('drops the open question with advice language and keeps the other', async () => {
    const { outcome } = await run();
    expect(outcome.openQuestions).toEqual([PLANTED_QUESTIONS.kept]);
    expect(outcome.droppedQuestions).toEqual([PLANTED_QUESTIONS.dropped]);
  });

  it('leaves nothing unverified: every claim ends supported or removed', async () => {
    const { outcome } = await run();
    expect(outcome.byKey.size).toBe(PLANTED_CLAIMS.length);
    expect([...outcome.byKey.values()].filter((c) => c.status === 'unverified')).toEqual([]);
  });
});
