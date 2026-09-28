// Shared helpers for the T00 spike checks.
// Secrets: values are read from .env at runtime and never printed. Every string that leaves
// a check (console or output file) goes through redact().
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const ROOT = resolve(import.meta.dirname, '..');
export const OUT = join(import.meta.dirname, 'output');

export type Status = 'pass' | 'partial' | 'fail' | 'skipped';

export interface CheckOutcome {
  status: Exclude<Status, 'skipped'>;
  reason?: string;
  evidence: Record<string, unknown>;
  limits: string[];
}

export interface CheckResult extends CheckOutcome {
  check: string;
  title: string;
  status: Status;
  ms: number;
  ranAt: string;
}

export interface Ctx {
  env(name: string): string | undefined;
  log(message: string): void;
  readOutput<T>(name: string): T | undefined;
  writeOutput(name: string, data: unknown): void;
}

export interface Check {
  name: string;
  title: string;
  keys: string[];
  run(ctx: Ctx): Promise<CheckOutcome>;
}

const SECRET_KEYS = [
  'MONGODB_URI',
  'JWT_SECRET',
  'MCP_TOKEN_SECRET',
  'ALPACA_API_KEY_ID',
  'ALPACA_API_SECRET_KEY',
  'FINNHUB_API_KEY',
  'GROQ_API_KEY',
  'GOOGLE_GENERATIVE_AI_API_KEY',
  'X_BEARER_TOKEN',
];

let secrets: string[] = [];

export function loadEnv(): void {
  const file = join(ROOT, '.env');
  if (existsSync(file)) process.loadEnvFile(file);
  secrets = SECRET_KEYS.map((k) => process.env[k]).filter((v): v is string => !!v && v.length >= 6);
  const uri = process.env.MONGODB_URI;
  if (uri) {
    try {
      const password = decodeURIComponent(new URL(uri).password);
      if (password) secrets.push(password, encodeURIComponent(password));
    } catch {
      // Not a parseable URL; the full value is already redacted.
    }
  }
  secrets.sort((a, b) => b.length - a.length);
}

export function redact(text: string): string {
  let out = text;
  for (const s of secrets) out = out.split(s).join('[REDACTED]');
  return out;
}

// SPIKE_SIMULATE_MISSING=KEY1,KEY2 makes those keys look unset, to test the skip path
// without touching .env.
function simulatedMissing(): Set<string> {
  return new Set((process.env.SPIKE_SIMULATE_MISSING ?? '').split(',').map((s) => s.trim()).filter(Boolean));
}

export function envValue(name: string): string | undefined {
  if (simulatedMissing().has(name)) return undefined;
  const v = process.env[name];
  return v && v.trim() ? v : undefined;
}

export function makeCtx(check: string): Ctx {
  return {
    env: envValue,
    log: (message) => console.log(`  [${check}] ${redact(message)}`),
    readOutput: <T>(name: string) => {
      const file = join(OUT, `${name}.json`);
      return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as T) : undefined;
    },
    writeOutput: (name, data) => writeJson(name, data),
  };
}

export function writeJson(name: string, data: unknown): void {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, `${name}.json`), redact(JSON.stringify(data, null, 2)) + '\n');
}

export interface HttpResult<T> {
  status: number;
  ms: number;
  headers: Headers;
  body: T;
}

export async function http<T = unknown>(
  url: string,
  init: RequestInit & { timeoutMs?: number; as?: 'json' | 'text' } = {},
): Promise<HttpResult<T>> {
  const { timeoutMs = 30_000, as = 'json', ...rest } = init;
  const started = performance.now();
  const res = await fetch(url, { ...rest, signal: AbortSignal.timeout(timeoutMs) });
  const text = await res.text();
  const ms = Math.round(performance.now() - started);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} from ${new URL(url).host}${new URL(url).pathname}: ${redact(text.slice(0, 300))}`);
  }
  const body = (as === 'json' ? JSON.parse(text) : text) as T;
  return { status: res.status, ms, headers: res.headers, body };
}

export function pickHeaders(headers: Headers | Record<string, string> | undefined, prefix: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers) return out;
  const entries = headers instanceof Headers ? [...headers.entries()] : Object.entries(headers);
  for (const [k, v] of entries) if (k.toLowerCase().startsWith(prefix)) out[k.toLowerCase()] = String(v);
  return out;
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    const cause = err.cause instanceof Error ? ` (cause: ${err.cause.message})` : '';
    return redact(`${err.name}: ${err.message}${cause}`);
  }
  return redact(String(err));
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
