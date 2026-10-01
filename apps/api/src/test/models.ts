import type { LanguageModel } from 'ai';
import { APICallError } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import type { ModelRef } from '../llm/client';

// Test doubles for model calls. Tests never reach a provider.

// A 429 as the SDK reports it. Groq sends retry-after; Gemini puts retryDelay in the body.
export function rateLimitError(retryAfterSeconds?: number, responseBody?: string): APICallError {
  return new APICallError({
    message: 'Rate limit reached',
    url: 'https://api.test/v1/chat/completions',
    requestBodyValues: {},
    statusCode: 429,
    responseHeaders:
      retryAfterSeconds === undefined ? {} : { 'retry-after': String(retryAfterSeconds) },
    ...(responseBody === undefined ? {} : { responseBody }),
    isRetryable: true,
  });
}

// Groq's answer when the model's JSON fails the output schema it checks on its side: a 400, not a
// 429, with the rejected text in failed_generation.
export function schemaFailureError(failedGeneration = '{"error": "User request not allowed."}') {
  return new APICallError({
    message: 'Generated JSON does not match the expected schema. Please adjust your prompt.',
    url: 'https://api.test/v1/chat/completions',
    requestBodyValues: {},
    statusCode: 400,
    responseBody: JSON.stringify({
      error: {
        message: 'Generated JSON does not match the expected schema. Please adjust your prompt.',
        type: 'invalid_request_error',
        code: 'json_validate_failed',
        failed_generation: failedGeneration,
      },
    }),
    isRetryable: false,
  });
}

// A model turn that calls tools, the way a provider answers a call with tools.
export interface ToolTurn {
  text?: string;
  toolCalls: { toolCallId?: string; toolName: string; input: unknown }[];
  usage?: { input: number; output: number };
}

export type ModelReply = string | Error | ToolTurn;

// A model that answers each call with the next reply (text, tool calls, or a thrown error), with
// usage. onCall runs before each answer, for tests that look at state between turns.
export function mockModel(
  modelId: string,
  replies: ModelReply[],
  usage = { input: 500, output: 300 },
  onCall?: (call: number) => Promise<void> | void,
): MockLanguageModelV4 {
  let call = 0;
  return new MockLanguageModelV4({
    modelId,
    doGenerate: async () => {
      const index = call++;
      await onCall?.(index);
      const reply = replies[Math.min(index, replies.length - 1)];
      if (reply === undefined) throw new Error(`no reply configured for ${modelId}`);
      if (reply instanceof Error) throw reply;
      const turn = typeof reply === 'string' ? null : reply;
      const used = turn?.usage ?? usage;
      return {
        content:
          turn === null
            ? [{ type: 'text' as const, text: reply as string }]
            : [
                ...(turn.text ? [{ type: 'text' as const, text: turn.text }] : []),
                ...turn.toolCalls.map((c, i) => ({
                  type: 'tool-call' as const,
                  toolCallId: c.toolCallId ?? `call-${index}-${i}`,
                  toolName: c.toolName,
                  input: typeof c.input === 'string' ? c.input : JSON.stringify(c.input),
                })),
              ],
        finishReason:
          turn === null || turn.toolCalls.length === 0
            ? { unified: 'stop' as const, raw: 'stop' }
            : { unified: 'tool-calls' as const, raw: 'tool_calls' },
        usage: {
          inputTokens: {
            total: used.input,
            noCache: used.input,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: { total: used.output, text: used.output, reasoning: undefined },
        },
        warnings: [],
      };
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
