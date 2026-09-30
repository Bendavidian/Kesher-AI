import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { MIN_SECRET_LENGTH } from '@kesher/shared';
import { z } from 'zod';
import type { AlpacaKeys } from '../ingest/alpaca';
import type { ModelKeys } from '../llm/client';

// The repo root .env, from apps/api/src/config.
const ROOT_ENV_FILE = resolve(import.meta.dirname, '../../../../.env');

export const Env = z
  .object({
    MONGODB_URI: z.string().regex(/^mongodb(\+srv)?:\/\//),
    // Development routes such as POST /dev/replay are mounted everywhere except production.
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    // Automatic research after scoring (the research gate). On unless set to false; any other
    // value stops the api at startup, naming the key.
    AUTO_RESEARCH: z
      .enum(['true', 'false'])
      .default('true')
      .transform((value) => value === 'true'),
    // POST /demo/replay, the reset and replay of the pinned demo item for a signed in user
    // (SPEC.md decision log, T18). Unset, it is on outside production and off in production, so
    // a deployed instance opts in; any other value stops the api at startup.
    DEMO_MODE: z.enum(['true', 'false']).optional(),
    // The local embedding model (about 300 MB of memory once loaded). Off on a host that cannot
    // hold it, such as the 512 MB free instance: events stay unembedded, search_news keeps its
    // word list, and research runs without search_filings (SPEC.md decision log, T18). On unless
    // set to false; any other value stops the api at startup.
    LOCAL_EMBEDDINGS: z
      .enum(['true', 'false'])
      .default('true')
      .transform((value) => value === 'true'),
  })
  .transform(({ DEMO_MODE, ...env }) => ({
    ...env,
    DEMO_MODE: DEMO_MODE === undefined ? env.NODE_ENV !== 'production' : DEMO_MODE === 'true',
  }));
export type Env = z.infer<typeof Env>;

// The recorders need Alpaca. The api replays news from recordings and reads price data from the
// local cache first, so it starts without the keys (loadAlpacaKeys).
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
function readEnv(): NodeJS.ProcessEnv {
  if (existsSync(ROOT_ENV_FILE)) process.loadEnvFile(ROOT_ENV_FILE);
  return process.env;
}

function parse<T>(schema: z.ZodType<T>, source: NodeJS.ProcessEnv): T {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const keys = [...new Set(parsed.error.issues.map((issue) => issue.path.join('.')))];
    throw new Error(`Missing or invalid environment variables: ${keys.join(', ')}`);
  }
  return parsed.data;
}

function load<T>(schema: z.ZodType<T>): T {
  return parse(schema, readEnv());
}

export function loadEnv(): Env {
  return load(Env);
}

export function loadAlpacaEnv(): AlpacaEnv {
  return load(AlpacaEnv);
}

// Only the graph build job reads SEC EDGAR, which requires a User-Agent with a contact.
const SecEnv = z.object({
  SEC_USER_AGENT: z.string().trim().min(1),
});
export type SecEnv = z.infer<typeof SecEnv>;

export function loadSecEnv(): SecEnv {
  return load(SecEnv);
}

// Only the graph build job reads Finnhub (peers and profiles).
const FinnhubEnv = z.object({
  FINNHUB_API_KEY: z.string().min(1),
});
export type FinnhubEnv = z.infer<typeof FinnhubEnv>;

export function loadFinnhubEnv(): FinnhubEnv {
  return load(FinnhubEnv);
}

// Optional for the api: market data not in the local cache fails naming the keys when they are
// missing (MissingAlpacaKeysError), and everything else works without them.
const OptionalAlpacaEnv = z.object({
  ALPACA_API_KEY_ID: z.string().min(1).optional().catch(undefined),
  ALPACA_API_SECRET_KEY: z.string().min(1).optional().catch(undefined),
});

export function loadAlpacaKeys(): AlpacaKeys | undefined {
  const env = load(OptionalAlpacaEnv);
  if (!env.ALPACA_API_KEY_ID || !env.ALPACA_API_SECRET_KEY) return undefined;
  return { keyId: env.ALPACA_API_KEY_ID, secretKey: env.ALPACA_API_SECRET_KEY };
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

// Live ingestion (T10) runs only where LIVE_INGEST is true, on one machine: the free Alpaca plan
// allows one live WebSocket (SPEC.md Replay and recording). With it on, the api does not start
// without the Alpaca keys and the SEC User-Agent, so a live machine never runs half configured.
const LiveSwitch = z.object({ LIVE_INGEST: z.stringbool().default(false) });
const LiveEnv = z.object({
  ALPACA_API_KEY_ID: z.string().min(1),
  ALPACA_API_SECRET_KEY: z.string().min(1),
  // EDGAR fair access: a name and a contact. Not a secret, but never printed.
  SEC_USER_AGENT: z.string().trim().min(1),
});

export type LiveConfig =
  { enabled: false } | { enabled: true; alpaca: AlpacaKeys; secUserAgent: string };

export function parseLiveEnv(source: NodeJS.ProcessEnv): LiveConfig {
  if (!parse(LiveSwitch, source).LIVE_INGEST) return { enabled: false };
  const env = parse(LiveEnv, source);
  return {
    enabled: true,
    alpaca: { keyId: env.ALPACA_API_KEY_ID, secretKey: env.ALPACA_API_SECRET_KEY },
    secUserAgent: env.SEC_USER_AGENT,
  };
}

export function loadLiveEnv(): LiveConfig {
  return parseLiveEnv(readEnv());
}
