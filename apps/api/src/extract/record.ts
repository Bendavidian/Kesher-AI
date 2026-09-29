import { existsSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { loadModelKeys } from '../config/env';
import { toIncomingItem } from '../ingest/alpaca';
import { loadRecording } from '../ingest/recordings';
import { writeJson } from '../graph/json';
import { createModelClient, resolveFromKeys } from '../llm/client';
import { modelRecordingPath } from '../llm/recordings';
import { countingClock, recordModels } from './recordModels';

// npm run record:models -- --id 38062166 [--force]
// Runs the injection screen and the extraction for real, once, on an item that is already in
// recordings/alpaca, and writes the raw answers to recordings/models/<id>.json. Tests replay them
// through mock models. Free tier calls only: one prompt guard call per chunk and one extraction.

const Args = z.object({
  id: z.string().regex(/^\d{1,20}$/),
  force: z.boolean().default(false),
});

const { values } = parseArgs({
  options: { id: { type: 'string' }, force: { type: 'boolean' } },
});
const args = Args.safeParse(values);
if (!args.success) {
  console.error('Usage: npm run record:models -- --id <alpaca news id> [--force]');
  process.exit(1);
}
const { id, force } = args.data;

const path = modelRecordingPath(id);
if (existsSync(path) && !force) {
  console.error(`${path} exists; pass --force to record it again.`);
  process.exit(1);
}
const recording = await loadRecording(id);
if (!recording) {
  console.error(`No recording for Alpaca news ${id}; run npm run record first.`);
  process.exit(1);
}

const clock = countingClock();
const client = createModelClient({ resolve: resolveFromKeys(loadModelKeys()), clock });
const models = await recordModels(client, id, toIncomingItem(recording.item), {
  waitedMs: clock.waitedMs,
});
const chunks = models.screen.chunks;

// Formatted the way npm run lint checks it.
await writeJson(path, models);
console.log(
  `Recorded ${chunks.length} screen answer(s) and one extraction (${models.extraction.provider} ${models.extraction.model}, ${models.extraction.usage.totalTokens ?? '?'} tokens) to ${path}`,
);
