import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { loadModelKeys } from '../config/env';
import { toIncomingItem } from '../ingest/alpaca';
import { loadRecording } from '../ingest/recordings';
import { createModelClient, resolveFromKeys } from '../llm/client';
import { ModelRecording, modelRecordingPath } from '../llm/recordings';
import { chunkText, screenInput } from '../screen/injection';
import { extractSource } from './extraction';

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

const item = toIncomingItem(recording.item);
const client = createModelClient({ resolve: resolveFromKeys(loadModelKeys()) });

const input = screenInput(item);
const chunks: string[] = [];
let screenModel = '';
for (const chunk of chunkText(input)) {
  const answer = await client.screenChunk(chunk);
  chunks.push(answer.text);
  screenModel = answer.model;
}

const result = await extractSource(client, item);
const models = ModelRecording.parse({
  externalId: id,
  recordedAt: new Date().toISOString(),
  screen: { model: screenModel, input, chunks },
  extraction: {
    provider: result.extraction.provider,
    model: result.extraction.model,
    text: result.text,
    usage: {
      inputTokens: result.usage.inputTokens ?? null,
      outputTokens: result.usage.outputTokens ?? null,
      totalTokens: result.usage.totalTokens ?? null,
    },
  },
});

await mkdir(dirname(path), { recursive: true });
await writeFile(path, `${JSON.stringify(models, null, 2)}\n`);
console.log(
  `Recorded ${chunks.length} screen answer(s) and one extraction (${models.extraction.provider} ${models.extraction.model}, ${models.extraction.usage.totalTokens ?? '?'} tokens) to ${path}`,
);
