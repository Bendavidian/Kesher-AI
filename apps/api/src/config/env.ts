import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { MIN_SECRET_LENGTH } from '@kesher/shared';
import { z } from 'zod';
import type { ModelKeys } from '../llm/client';

// The repo root .env, from apps/api/src/config.
const ROOT_ENV_FILE = resolve(import.meta.dirname, '../../../../.env');

export const Env = z.object({
  MONGODB_URI: z.string().regex(/^mongodb(\+srv)?:\/\//),
  // Development routes such as POST /dev/replay are mounted everywhere except production.
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  // Automatic research after scoring (the research gate). On unless set to false; any other value
  // stops the api at startup, naming the key.
  AUTO_RESEARCH: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
});
export type Env = z.infer<typeof Env>;

// Only the recorder needs Alpaca; the api itself replays from recordings.
const AlpacaEnv = z.object({
  ALPACA_API_KEY_ID: z.string().min(1),
  ALPACA_API_SECRET_KEY: z.string().min(1),
});
export type AlpacaEnv = z.infer<typeof AlpacaEnv>;

// The key that signs and verifies MCP run tokens (docs/INTERFACES.md, Run token).
export const McpEnv = z.object({
  MCP_TOKEN_SECRET: z.string().min(MIN_SECRET_LENGTH),
});
export type McpEnv = z.infer<typeof McpEnv>;

// The key that signs and verifies web sessions (docs/INTERFACES.md, Auth). Separate from the run
// token secret, so a leaked run token can never act as a session.
export const AuthEnv = z.object({
  JWT_SECRET: z.string().min(MIN_SECRET_LENGTH),
});
export type AuthEnv = z.infer<typeof AuthEnv>;

// Loads the root .env at runtime when it exists and validates what the caller needs. Nothing
// runs at import, so tests and CI never need a .env. Values are never printed; errors name keys
// only.
function load<T>(schema: z.ZodType<T>): T {
  if (existsSync(ROOT_ENV_FILE)) process.loadEnvFile(ROOT_ENV_FILE);
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const keys = [...new Set(parsed.error.issues.map((issue) => issue.path.join('.')))];
    throw new Error(`Missing or invalid environment variables: ${keys.join(', ')}`);
  }
  return parsed.data;
}

export function loadEnv(): Env {
  return load(Env);
}

export function loadAlpacaEnv(): AlpacaEnv {
  return load(AlpacaEnv);
}

// Model keys are optional: the api starts without them, and only a call that needs a provider
// fails, naming the missing key (MissingModelKeyError).
const ModelEnv = z.object({
  GROQ_API_KEY: z.string().min(1).optional().catch(undefined),
  GOOGLE_GENERATIVE_AI_API_KEY: z.string().min(1).optional().catch(undefined),
});

export function loadModelKeys(): ModelKeys {
  const env = load(ModelEnv);
  return { groq: env.GROQ_API_KEY, google: env.GOOGLE_GENERATIVE_AI_API_KEY };
}

export function loadMcpEnv(): McpEnv {
  return load(McpEnv);
}

export function loadAuthEnv(): AuthEnv {
  return load(AuthEnv);
}
