import { createGoogle } from '@ai-sdk/google';
import { createGroq } from '@ai-sdk/groq';
import type { LlmProvider } from '@kesher/shared';
import {
  APICallError,
  generateText,
  NoObjectGeneratedError,
  NoOutputGeneratedError,
  Output,
  ToolChoiceViolationError,
  type LanguageModel,
  type ModelMessage,
  type ToolChoice,
  type ToolSet,
} from 'ai';
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

// An answer that failed the output schema. Groq checks it on its side and answers 400 with the
// code json_validate_failed, not 429; the SDK checks every other answer and throws
// NoObjectGeneratedError, or NoOutputGeneratedError when there was no text to parse. Any other
// 400 (a request the provider refuses) is not one: asking again would not change it. The code is
// read from the parsed body, never searched in it: failed_generation holds model text written
// from an untrusted article.
export function isSchemaFailure(error: unknown): boolean {
  if (NoObjectGeneratedError.isInstance(error) || NoOutputGeneratedError.isInstance(error)) {
    return true;
  }
  if (!APICallError.isInstance(error) || error.statusCode !== 400) return false;
  try {
    const body = JSON.parse(error.responseBody ?? '') as { error?: { code?: unknown } };
    return body.error?.code === 'json_validate_failed';
  } catch {
    return false;
  }
}

// The wait a retry-after header asks for, in seconds; undefined without one.
function headerWaitMs(error: APICallError): number | undefined {
  const seconds = Number(error.responseHeaders?.['retry-after']);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : undefined;
}

// The wait a 429 asks for: Groq's retry-after header, or the retryDelay Gemini puts in the body.
// undefined when it names none. Runs read both; single calls keep the header only (T04).
export function requestedWaitMs(error: APICallError): number | undefined {
  const header = headerWaitMs(error);
  if (header !== undefined) return header;
  const delay = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(error.responseBody ?? '')?.[1];
  return delay === undefined ? undefined : Math.ceil(Number(delay) * 1000);
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

export interface SingleOptions {
  // Extraction only (SPEC.md decision log, T19): an answer that fails the schema gets one more
  // call on Groq, then the Gemini fallback, instead of failing the item at once.
  schemaRetry?: boolean;
}

export interface SingleResult<T> extends ModelRef {
  output: T;
  // The raw answer, kept for recordings.
  text: string;
  usage: TokenUsage;
}

// One turn of an agent run: the model sees the tools but executes none. Code runs every tool call
// it returns (T08).
export interface RunStepRequest {
  system: string;
  messages: ModelMessage[];
  tools: ToolSet;
  toolChoice: ToolChoice<ToolSet>;
  maxOutputTokens: number;
  // System, tools and messages, estimated by the caller for the limiter's reservation.
  estimatedInputTokens: number;
}

export interface RunStepResult extends ModelRef {
  text: string;
  toolCalls: { toolCallId: string; toolName: string; input: unknown }[];
  // The assistant message to append to the history, with any provider metadata it carries.
  responseMessages: ModelMessage[];
  finishReason: string;
  usage: TokenUsage;
  // The model ignored the forced tool choice. Nothing of this turn goes into the history, and
  // its usage is unknown.
  toolChoiceViolated: boolean;
}

export interface RunWait extends ModelRef {
  attempt: number;
  waitMs: number;
}

// The 429 policy inside a run: wait on the same provider, at most 30 seconds per wait and at most
// 3 retries. A longer wait, such as a daily quota, ends the run instead of blocking it.
export const RUN_MAX_WAIT_MS = 30_000;
export const RUN_MAX_RETRIES = 3;
const RUN_DEFAULT_WAIT_MS = 10_000;
const runWaitMs = (error: APICallError) => requestedWaitMs(error) ?? RUN_DEFAULT_WAIT_MS;

export class RunRateLimitError extends Error {
  constructor(
    readonly ref: ModelRef,
    readonly reason: 'wait_too_long' | 'retries_exhausted',
    readonly waitMs: number,
    readonly retries: number,
  ) {
    super(
      reason === 'wait_too_long'
        ? `${ref.provider} ${ref.model} asked for a ${waitMs} ms wait, over the ${RUN_MAX_WAIT_MS} ms limit`
        : `${ref.provider} ${ref.model} still answered 429 after ${retries} retries`,
    );
    this.name = 'RunRateLimitError';
  }
}

export interface ModelClient {
  generateSingle<T>(request: SingleRequest<T>, options?: SingleOptions): Promise<SingleResult<T>>;
  screenChunk(text: string): Promise<{ text: string; model: string }>;
  pickRunProvider(budgetTokens: number): ModelRef;
  // onWait runs before each wait, so the run records it as a step.
  runStep(
    ref: ModelRef,
    request: RunStepRequest,
    onWait?: (wait: RunWait) => Promise<void> | void,
  ): Promise<RunStepResult>;
}

export interface ModelClientOptions {
  resolve: (ref: ModelRef) => LanguageModel;
  clock?: Clock;
}

const DEFAULT_MAX_OUTPUT_TOKENS = 1_024;
// Calls on Groq for one request with schemaRetry before Gemini gets it.
const SCHEMA_ATTEMPTS = 2;
const SCREEN_OUTPUT_TOKENS = 16;
const DEFAULT_BLOCK_MS = 60_000;

// About 4 characters per token: a reservation, corrected with the real usage after the call.
const estimateTokens = (text: string) => Math.ceil(text.length / 4);

// What the model sent when it did not call the tool it was told to. The caller decides what that
// means; the answer never enters the history.
function violation(ref: ModelRef, error: ToolChoiceViolationError): RunStepResult {
  const parts = error.content as {
    type: string;
    text?: string;
    toolCallId?: string;
    toolName?: string;
    input?: unknown;
  }[];
  return {
    ...ref,
    text: parts.map((p) => (p.type === 'text' ? (p.text ?? '') : '')).join(''),
    toolCalls: parts
      .filter((p) => p.type === 'tool-call')
      .map((p) => ({ toolCallId: p.toolCallId ?? '', toolName: p.toolName ?? '', input: p.input })),
    responseMessages: [],
    finishReason: error.finishReason,
    usage: { inputTokens: undefined, outputTokens: undefined, totalTokens: undefined },
    toolChoiceViolated: true,
  };
}

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
    // How long a 429 blocks this model.
    waitOf: (error: APICallError) => number = (error) => headerWaitMs(error) ?? DEFAULT_BLOCK_MS,
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
        limiter.block(clock.now() + waitOf(error));
      }
      throw error;
    }
  }

  const usageOf = (usage: {
    inputTokens: number | undefined;
    outputTokens: number | undefined;
    totalTokens: number | undefined;
  }): TokenUsage => ({
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens:
      usage.totalTokens ??
      (usage.inputTokens === undefined || usage.outputTokens === undefined
        ? undefined
        : usage.inputTokens + usage.outputTokens),
  });

  const groqOptions = (ref: ModelRef) =>
    ref.provider === 'groq' ? { providerOptions: { groq: { reasoningEffort: 'low' } } } : {};

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
          ...groqOptions(ref),
        }),
    );
    return { ...ref, output: result.output, text: result.text, usage: usageOf(result.usage) };
  }

  return {
    // One call on Groq; on a 429 that same call goes to Gemini once (SPEC.md Stack). With
    // schemaRetry, an answer that fails the schema is asked again on Groq once, and a second
    // failure goes to Gemini too: at most three calls, and Gemini's failure is the one thrown.
    async generateSingle(request, { schemaRetry = false } = {}) {
      for (let attempt = 1; ; attempt++) {
        try {
          return await single(MODELS.extraction, request);
        } catch (error) {
          if (isRateLimited(error)) return single(MODELS.fallback, request);
          if (!schemaRetry || !isSchemaFailure(error)) throw error;
          if (attempt === SCHEMA_ATTEMPTS) return single(MODELS.fallback, request);
        }
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

    async runStep(ref, request, onWait) {
      for (let retries = 0; ; retries++) {
        try {
          const result = await call(
            ref,
            request.estimatedInputTokens + request.maxOutputTokens,
            (model) =>
              generateText({
                model,
                system: request.system,
                messages: request.messages,
                tools: request.tools,
                toolChoice: request.toolChoice,
                maxOutputTokens: request.maxOutputTokens,
                maxRetries: 0,
                ...groqOptions(ref),
              }),
            runWaitMs,
          );
          return {
            ...ref,
            text: result.text,
            toolCalls: result.toolCalls.map((c) => ({
              toolCallId: c.toolCallId,
              toolName: c.toolName,
              input: c.input as unknown,
            })),
            responseMessages: result.responseMessages,
            finishReason: result.finishReason,
            usage: usageOf(result.usage),
            toolChoiceViolated: false,
          };
        } catch (error) {
          if (ToolChoiceViolationError.isInstance(error)) return violation(ref, error);
          if (!isRateLimited(error)) throw error;
          // call() has already blocked this model for the wait, so the next acquire sleeps it.
          const waitMs = runWaitMs(error);
          if (waitMs > RUN_MAX_WAIT_MS) {
            throw new RunRateLimitError(ref, 'wait_too_long', waitMs, retries);
          }
          if (retries >= RUN_MAX_RETRIES) {
            throw new RunRateLimitError(ref, 'retries_exhausted', waitMs, retries);
          }
          await onWait?.({ ...ref, attempt: retries + 1, waitMs });
        }
      }
    },
  };
}
