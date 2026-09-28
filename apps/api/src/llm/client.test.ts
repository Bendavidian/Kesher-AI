import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { mockModel, rateLimitError, resolveMocks } from '../test/models';
import {
  createModelClient,
  isRateLimited,
  MissingModelKeyError,
  MODELS,
  resolveFromKeys,
} from './client';
import type { Clock } from './limiter';

const Answer = z.object({ ok: z.boolean() });
const request = { system: 'Answer as JSON.', prompt: 'Are you there?', schema: Answer };

function stillClock(start = 1_000_000): Clock {
  let now = start;
  return {
    now: () => now,
    sleep: (ms) => {
      now += ms;
      return Promise.resolve();
    },
  };
}

describe('generateSingle', () => {
  it('answers from Groq gpt-oss-120b with low reasoning effort and no tools', async () => {
    const groq = mockModel(MODELS.extraction.model, ['{"ok":true}']);
    const client = createModelClient({ resolve: resolveMocks({ [groq.modelId]: groq }) });

    const result = await client.generateSingle(request);

    expect(result).toMatchObject({
      output: { ok: true },
      text: '{"ok":true}',
      provider: 'groq',
      model: 'openai/gpt-oss-120b',
      usage: { inputTokens: 500, outputTokens: 300, totalTokens: 800 },
    });
    const [call] = groq.doGenerateCalls;
    expect(call?.providerOptions).toEqual({ groq: { reasoningEffort: 'low' } });
    expect(call?.tools).toBeUndefined();
  });

  it('sends that single call to Gemini when Groq answers 429', async () => {
    const groq = mockModel(MODELS.extraction.model, [rateLimitError(30)]);
    const gemini = mockModel(MODELS.fallback.model, ['{"ok":true}']);
    const client = createModelClient({
      resolve: resolveMocks({ [groq.modelId]: groq, [gemini.modelId]: gemini }),
    });

    const result = await client.generateSingle(request);

    expect(result).toMatchObject({
      output: { ok: true },
      provider: 'google',
      model: 'gemini-3.5-flash-lite',
    });
    expect(groq.doGenerateCalls).toHaveLength(1);
    expect(gemini.doGenerateCalls).toHaveLength(1);
    expect(gemini.doGenerateCalls[0]?.providerOptions).toBeUndefined();
  });

  it('releases the reservation of a 429, so Groq is limited only by its block', async () => {
    const clock = stillClock();
    const groq = mockModel(MODELS.extraction.model, [rateLimitError(1), '{"ok":true}']);
    const gemini = mockModel(MODELS.fallback.model, ['{"ok":true}']);
    const client = createModelClient({
      resolve: resolveMocks({ [groq.modelId]: groq, [gemini.modelId]: gemini }),
      clock,
    });
    const long = { ...request, maxOutputTokens: 7_000 };

    await client.generateSingle(long);
    const start = clock.now();
    const second = await client.generateSingle(long);

    // Only the 1 second retry-after, not 60 seconds for a 7,000 token reservation.
    expect(clock.now() - start).toBe(1_000);
    expect(second.provider).toBe('groq');
  });

  it('does not fall back on an error that is not a 429', async () => {
    const groq = mockModel(MODELS.extraction.model, [new Error('bad request')]);
    const gemini = mockModel(MODELS.fallback.model, ['{"ok":true}']);
    const client = createModelClient({
      resolve: resolveMocks({ [groq.modelId]: groq, [gemini.modelId]: gemini }),
    });

    await expect(client.generateSingle(request)).rejects.toThrow('bad request');
    expect(gemini.doGenerateCalls).toHaveLength(0);
  });

  it('surfaces a 429 from both providers as rate limited', async () => {
    const groq = mockModel(MODELS.extraction.model, [rateLimitError()]);
    const gemini = mockModel(MODELS.fallback.model, [rateLimitError()]);
    const client = createModelClient({
      resolve: resolveMocks({ [groq.modelId]: groq, [gemini.modelId]: gemini }),
    });

    const error: unknown = await client.generateSingle(request).catch((e: unknown) => e);
    expect(isRateLimited(error)).toBe(true);
  });

  it('rejects output that does not match the schema', async () => {
    const groq = mockModel(MODELS.extraction.model, ['{"ok":"yes"}']);
    const client = createModelClient({ resolve: resolveMocks({ [groq.modelId]: groq }) });

    await expect(client.generateSingle(request)).rejects.toThrow();
  });
});

describe('screenChunk', () => {
  it('returns the raw prompt guard answer for one chunk', async () => {
    const guard = mockModel(MODELS.screen.model, ['0.0012']);
    const client = createModelClient({ resolve: resolveMocks({ [guard.modelId]: guard }) });

    expect(await client.screenChunk('TSMC halts production')).toEqual({
      text: '0.0012',
      model: 'meta-llama/llama-prompt-guard-2-86m',
    });
    expect(guard.doGenerateCalls[0]?.tools).toBeUndefined();
  });
});

describe('pickRunProvider', () => {
  it('picks Gemini for a whole run while it has room', () => {
    const client = createModelClient({ resolve: resolveMocks({}), clock: stillClock() });
    expect(client.pickRunProvider(6_000)).toEqual({
      provider: 'google',
      model: 'gemini-3.5-flash-lite',
    });
  });

  it('picks Groq for the whole run when Gemini answered 429', async () => {
    const groq = mockModel(MODELS.extraction.model, [rateLimitError(60)]);
    const gemini = mockModel(MODELS.fallback.model, [rateLimitError(60)]);
    const clock = stillClock();
    const client = createModelClient({
      resolve: resolveMocks({ [groq.modelId]: groq, [gemini.modelId]: gemini }),
      clock,
    });

    await client.generateSingle(request).catch(() => undefined);

    expect(client.pickRunProvider(6_000)).toEqual({
      provider: 'groq',
      model: 'openai/gpt-oss-120b',
    });
    await clock.sleep(61_000);
    expect(client.pickRunProvider(6_000).provider).toBe('google');
  });
});

describe('resolveFromKeys', () => {
  it('throws only when a model without a key is actually requested', () => {
    const resolve = resolveFromKeys({ groq: 'test-groq-key' });

    expect(() => resolve(MODELS.extraction)).not.toThrow();
    expect(() => resolve(MODELS.fallback)).toThrow(MissingModelKeyError);
    expect(() => resolve(MODELS.fallback)).toThrow('GOOGLE_GENERATIVE_AI_API_KEY is not set');
  });

  it('names the Groq key when it is missing', () => {
    expect(() => resolveFromKeys({})(MODELS.screen)).toThrow('GROQ_API_KEY is not set');
  });
});
