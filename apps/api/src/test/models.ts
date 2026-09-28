import type { LanguageModel } from 'ai';
import { APICallError } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import type { ModelRef } from '../llm/client';

// Test doubles for model calls. Tests never reach a provider.

export function rateLimitError(retryAfterSeconds?: number): APICallError {
  return new APICallError({
    message: 'Rate limit reached',
    url: 'https://api.test/v1/chat/completions',
    requestBodyValues: {},
    statusCode: 429,
    responseHeaders:
      retryAfterSeconds === undefined ? {} : { 'retry-after': String(retryAfterSeconds) },
    isRetryable: true,
  });
}

// A model that answers each call with the next text (or throws the next error), with usage.
export function mockModel(
  modelId: string,
  replies: (string | Error)[],
  usage = { input: 500, output: 300 },
): MockLanguageModelV4 {
  let call = 0;
  return new MockLanguageModelV4({
    modelId,
    doGenerate: () => {
      const reply = replies[Math.min(call++, replies.length - 1)];
      if (reply === undefined) throw new Error(`no reply configured for ${modelId}`);
      if (reply instanceof Error) return Promise.reject(reply);
      return Promise.resolve({
        content: [{ type: 'text', text: reply }],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: {
          inputTokens: {
            total: usage.input,
            noCache: usage.input,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: { total: usage.output, text: usage.output, reasoning: undefined },
        },
        warnings: [],
      });
    },
  });
}

// Resolves each model reference to its mock; an unknown reference fails the test loudly.
export function resolveMocks(models: Record<string, MockLanguageModelV4>) {
  return (ref: ModelRef): LanguageModel => {
    const model = models[ref.model];
    if (!model) throw new Error(`no mock for ${ref.provider}:${ref.model}`);
    return model;
  };
}
