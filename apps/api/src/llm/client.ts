import { createGoogle } from '@ai-sdk/google';
import { createGroq } from '@ai-sdk/groq';
import type { LlmProvider } from '@kesher/shared';
import { APICallError, generateText, Output, type LanguageModel } from 'ai';
import type { z } from 'zod';
import { RateLimiter, systemClock, type Clock } from './limiter';
import { MODEL_LIMITS } from './limits';

export interface ModelRef {
  provider: LlmProvider;
  model: string;
}

// The model split, SPEC.md Stack.
export const MODELS = {
  // Extraction and later the verifier: one call each, Gemini on a 429.
  extraction: { provider: 'groq', model: 'openai/gpt-oss-120b' },
  fallback: { provider: 'google', model: 'gemini-3.5-flash-lite' },
  // The injection screen. It labels and decides nothing, so it has no fallback.
  screen: { provider: 'groq', model: 'meta-llama/llama-prompt-guard-2-86m' },
  // The research agent (T08) picks one of these once per run.
  research: { provider: 'google', model: 'gemini-3.5-flash-lite' },
  researchFallback: { provider: 'groq', model: 'openai/gpt-oss-120b' },
} as const satisfies Record<string, ModelRef>;

const KEY_NAMES: Record<LlmProvider, string> = {
  groq: 'GROQ_API_KEY',
  google: 'GOOGLE_GENERATIVE_AI_API_KEY',
};

// Thrown only when a call needs a provider whose key is missing, so the api starts without keys
// and work that needs no model still runs.
export class MissingModelKeyError extends Error {
  constructor(readonly keyName: string) {
    super(`${keyName} is not set`);
    this.name = 'MissingModelKeyError';
  }
}

export type ModelKeys = Partial<Record<LlmProvider, string>>;

// Builds each provider on first use with its key. The key is passed straight to the SDK and never
// logged.
export function resolveFromKeys(keys: ModelKeys): (ref: ModelRef) => LanguageModel {
  let groq: ReturnType<typeof createGroq> | undefined;
  let google: ReturnType<typeof createGoogle> | undefined;
  return (ref) => {
    const apiKey = keys[ref.provider];
    if (!apiKey) throw new MissingModelKeyError(KEY_NAMES[ref.provider]);
    if (ref.provider === 'groq') {
      groq ??= createGroq({ apiKey });
      return groq(ref.model);
    }
    google ??= createGoogle({ apiKey });
    return google(ref.model);
  };
}

export function isRateLimited(error: unknown): error is APICallError {
  return APICallError.isInstance(error) && error.statusCode === 429;
}

export interface TokenUsage {
  inputTokens: number | undefined;
  outputTokens: number | undefined;
  totalTokens: number | undefined;
}

export interface SingleRequest<T> {
  system: string;
  // Untrusted content goes here, quoted by the caller.
  prompt: string;
  schema: z.ZodType<T>;
  maxOutputTokens?: number;
}

export interface SingleResult<T> extends ModelRef {
  output: T;
  // The raw answer, kept for recordings.
  text: string;
  usage: TokenUsage;
}

export interface ModelClient {
  generateSingle<T>(request: SingleRequest<T>): Promise<SingleResult<T>>;
  screenChunk(text: string): Promise<{ text: string; model: string }>;
  pickRunProvider(budgetTokens: number): ModelRef;
}

export interface ModelClientOptions {
  resolve: (ref: ModelRef) => LanguageModel;
  clock?: Clock;
}

const DEFAULT_MAX_OUTPUT_TOKENS = 1_024;
const SCREEN_OUTPUT_TOKENS = 16;
const DEFAULT_BLOCK_MS = 60_000;

// About 4 characters per token: a reservation, corrected with the real usage after the call.
const estimateTokens = (text: string) => Math.ceil(text.length / 4);

// Every model call goes through here: a limiter per model keeps each call inside the free tier's
// tokens per minute. No call gets tools; the models only read and answer.
export function createModelClient({
  resolve,
  clock = systemClock,
}: ModelClientOptions): ModelClient {
  const limiters = new Map<string, RateLimiter>();
  const limiterFor = (ref: ModelRef) => {
    const key = `${ref.provider}:${ref.model}`;
    let limiter = limiters.get(key);
    if (!limiter) {
      const limits = MODEL_LIMITS[key];
      if (!limits) throw new Error(`no free tier limits recorded for ${key}`);
      limiter = new RateLimiter(limits, clock);
      limiters.set(key, limiter);
    }
    return limiter;
  };

  async function call<R>(
    ref: ModelRef,
    estimate: number,
    run: (model: LanguageModel) => Promise<{ usage: { totalTokens?: number | undefined } } & R>,
  ): Promise<R> {
    const model = resolve(ref);
    const limiter = limiterFor(ref);
    const reservation = await limiter.acquire(estimate);
    try {
      const result = await run(model);
      reservation.settle(result.usage.totalTokens);
      return result;
    } catch (error) {
      // A 429 used no tokens, so its reservation is released. Any other failure may have used
      // tokens (an answer that failed the schema), so it keeps the estimate.
      if (isRateLimited(error)) {
        reservation.settle(0);
        const seconds = Number(error.responseHeaders?.['retry-after']);
        limiter.block(
          clock.now() +
            (Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : DEFAULT_BLOCK_MS),
        );
      }
      throw error;
    }
  }

  async function single<T>(ref: ModelRef, request: SingleRequest<T>): Promise<SingleResult<T>> {
    const maxOutputTokens = request.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
    const result = await call(
      ref,
      estimateTokens(request.system + request.prompt) + maxOutputTokens,
      (model) =>
        generateText({
          model,
          system: request.system,
          prompt: request.prompt,
          output: Output.object({ schema: request.schema }),
          maxOutputTokens,
          maxRetries: 0,
          ...(ref.provider === 'groq'
            ? { providerOptions: { groq: { reasoningEffort: 'low' } } }
            : {}),
        }),
    );
    const { inputTokens, outputTokens } = result.usage;
    return {
      ...ref,
      output: result.output,
      text: result.text,
      usage: {
        inputTokens,
        outputTokens,
        totalTokens:
          result.usage.totalTokens ??
          (inputTokens === undefined || outputTokens === undefined
            ? undefined
            : inputTokens + outputTokens),
      },
    };
  }

  return {
    // One call on Groq; on a 429 that same call goes to Gemini once (SPEC.md Stack).
    async generateSingle(request) {
      try {
        return await single(MODELS.extraction, request);
      } catch (error) {
        if (!isRateLimited(error)) throw error;
        return single(MODELS.fallback, request);
      }
    },

    async screenChunk(text) {
      const result = await call(
        MODELS.screen,
        estimateTokens(text) + SCREEN_OUTPUT_TOKENS,
        (model) => generateText({ model, prompt: text, maxRetries: 0 }),
      );
      return { text: result.text, model: MODELS.screen.model };
    },

    // For T08: a run keeps one provider from start to end. Gemini unless it answered 429 recently
    // or its window cannot fit the run's token budget now.
    pickRunProvider(budgetTokens) {
      const research = limiterFor(MODELS.research);
      return !research.isBlocked() && research.hasRoom(budgetTokens)
        ? MODELS.research
        : MODELS.researchFallback;
    },
  };
}
