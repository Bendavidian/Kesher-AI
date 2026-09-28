import type { ModelLimits } from './limiter';

// Free tier limits per model, read from the consoles on 28 Sep 2026 (docs/SPIKE.md, Console
// numbers), keyed by provider and model. Groq limits are per model, so each model gets its own
// limiter.
export const MODEL_LIMITS: Record<string, ModelLimits> = {
  'groq:openai/gpt-oss-120b': { rpm: 30, tpm: 8_000 },
  'groq:meta-llama/llama-prompt-guard-2-86m': { rpm: 30, tpm: 15_000 },
  'google:gemini-3.5-flash-lite': { rpm: 15, tpm: 250_000 },
};
