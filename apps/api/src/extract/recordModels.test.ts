import { APICallError } from 'ai';
import { describe, expect, it } from 'vitest';
import { toIncomingItem } from '../ingest/alpaca';
import { loadRecording } from '../ingest/recordings';
import { createModelClient, MODELS } from '../llm/client';
import { loadModelRecording } from '../llm/recordings';
import { mockModel, resolveMocks } from '../test/models';
import { countingClock, recordModels } from './recordModels';

describe('recordModels', () => {
  it('keeps the raw answers, the usage and one latency per call', async () => {
    const recorded = (await loadModelRecording('38062166'))!;
    const guard = mockModel(MODELS.screen.model, recorded.screen.chunks);
    const groq = mockModel(MODELS.extraction.model, [recorded.extraction.text], {
      input: 692,
      output: 154,
    });
    const client = createModelClient({
      resolve: resolveMocks({ [guard.modelId]: guard, [groq.modelId]: groq }),
    });
    const item = toIncomingItem((await loadRecording('38062166'))!.item);
    const now = new Date('2026-09-29T12:00:00.000Z');

    const result = await recordModels(client, '38062166', item, { now });

    expect(result).toMatchObject({
      externalId: '38062166',
      recordedAt: now.toISOString(),
      screen: {
        model: MODELS.screen.model,
        input: recorded.screen.input,
        chunks: recorded.screen.chunks,
      },
      extraction: {
        provider: 'groq',
        model: MODELS.extraction.model,
        text: recorded.extraction.text,
        usage: { inputTokens: 692, outputTokens: 154, totalTokens: 846 },
      },
    });
    expect(result.screen.latencyMs).toHaveLength(recorded.screen.chunks.length);
    expect(result.extraction.latencyMs).toBeGreaterThanOrEqual(0);
  });
});

describe('recordModels on a refusal', () => {
  it('records the rejected generation and the error instead of throwing', async () => {
    const recorded = (await loadModelRecording('38062166'))!;
    const refusal = new APICallError({
      message: 'Generated JSON does not match the expected schema.',
      url: 'https://api.test/v1/chat/completions',
      requestBodyValues: {},
      statusCode: 400,
      responseBody: JSON.stringify({
        error: { failed_generation: '{"error": "User request not allowed."}' },
      }),
      isRetryable: false,
    });
    const guard = mockModel(MODELS.screen.model, recorded.screen.chunks);
    const groq = mockModel(MODELS.extraction.model, [refusal]);
    const client = createModelClient({
      resolve: resolveMocks({ [guard.modelId]: guard, [groq.modelId]: groq }),
    });
    const item = toIncomingItem((await loadRecording('38062166'))!.item);

    const result = await recordModels(client, '38062166', item);

    expect(result.extraction).toMatchObject({
      provider: 'groq',
      model: MODELS.extraction.model,
      text: '{"error": "User request not allowed."}',
      usage: { inputTokens: null, outputTokens: null, totalTokens: null },
      failure: { status: 400, message: 'Generated JSON does not match the expected schema.' },
    });
  });
});

describe('countingClock', () => {
  it('adds up the time spent sleeping', async () => {
    const slept: number[] = [];
    const clock = countingClock({
      now: () => 0,
      sleep: (ms) => {
        slept.push(ms);
        return Promise.resolve();
      },
    });
    await clock.sleep(1_500);
    await clock.sleep(250);
    expect(clock.waitedMs()).toBe(1_750);
    expect(slept).toEqual([1_500, 250]);
  });
});
