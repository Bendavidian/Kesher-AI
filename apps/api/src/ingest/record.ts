import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { loadAlpacaEnv } from '../config/env';
import { fetchAlpacaNewsById } from './alpaca';
import { Recording, recordingPath } from './recordings';

// npm run record -- --id 38062166 --symbol TSM --date 2024-04-03 [--force]
// Fetches one historical Alpaca news item, selected by id inside one symbol's news for one UTC
// day, and writes it to recordings/alpaca/<id>.json for replay. Run by hand, once per item.

const Args = z.object({
  id: z.string().regex(/^\d{1,20}$/),
  symbol: z.string().regex(/^[A-Z][A-Z0-9.]{0,11}$/),
  date: z.iso.date(),
  force: z.boolean().default(false),
});

const { values } = parseArgs({
  options: {
    id: { type: 'string' },
    symbol: { type: 'string' },
    date: { type: 'string' },
    force: { type: 'boolean' },
  },
});
const args = Args.safeParse(values);
if (!args.success) {
  console.error(
    'Usage: npm run record -- --id <alpaca news id> --symbol <ticker> --date <YYYY-MM-DD> [--force]',
  );
  process.exit(1);
}
const { id, symbol, date, force } = args.data;

const path = recordingPath(id);
if (existsSync(path) && !force) {
  console.error(`${path} exists; pass --force to record it again.`);
  process.exit(1);
}

const env = loadAlpacaEnv();
const item = await fetchAlpacaNewsById({
  id: Number(id),
  symbol,
  date,
  keys: { keyId: env.ALPACA_API_KEY_ID, secretKey: env.ALPACA_API_SECRET_KEY },
});
// The raw item is written as Alpaca sent it, minus content; the whole recording is validated
// first, so replay can always load what was written.
const recording = { provider: 'alpaca', recordedAt: new Date().toISOString(), item };
Recording.parse(recording);

await mkdir(dirname(path), { recursive: true });
await writeFile(path, `${JSON.stringify(recording, null, 2)}\n`);
console.log(`Recorded Alpaca news ${id} to ${path}`);
