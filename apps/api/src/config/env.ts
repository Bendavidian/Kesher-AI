import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

// The repo root .env, from apps/api/src/config.
const ROOT_ENV_FILE = resolve(import.meta.dirname, '../../../../.env');

const Env = z.object({
  MONGODB_URI: z.string().regex(/^mongodb(\+srv)?:\/\//),
});
export type Env = z.infer<typeof Env>;

// Loads the root .env at runtime when it exists and validates what the api needs. Nothing runs
// at import, so tests and CI never need a .env. Values are never printed; errors name keys only.
export function loadEnv(): Env {
  if (existsSync(ROOT_ENV_FILE)) process.loadEnvFile(ROOT_ENV_FILE);
  const parsed = Env.safeParse(process.env);
  if (!parsed.success) {
    const keys = [...new Set(parsed.error.issues.map((issue) => issue.path.join('.')))];
    throw new Error(`Missing or invalid environment variables: ${keys.join(', ')}`);
  }
  return parsed.data;
}
