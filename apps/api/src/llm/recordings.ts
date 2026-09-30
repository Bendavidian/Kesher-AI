import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { LlmProvider } from '@kesher/shared';
import { z } from 'zod';
import { AlpacaNewsId, RECORDINGS_DIR } from '../ingest/recordings';

const Tokens = z.int().nonnegative().nullable();

// Real model answers for one recorded item, recordings/models/<alpaca id>.json. Tests replay
// them through mock models, so no test calls a provider. Written by npm run record:models.
export const ModelRecording = z.strictObject({
  externalId: AlpacaNewsId,
  recordedAt: z.iso.datetime(),
  screen: z.strictObject({
    model: z.string().min(1),
    // The text that was screened, and prompt guard's raw answer for each of its chunks.
    input: z.string().min(1),
    chunks: z.array(z.string()).min(1),
    // Wall time of each chunk's call when it was recorded; recordings made before T16 have none.
    latencyMs: z.array(z.number().nonnegative()).optional(),
  }),
  extraction: z.strictObject({
    provider: LlmProvider,
    model: z.string().min(1),
    // The raw structured answer, exactly as the model sent it. For a failure, the generation the
    // provider rejected, when it returned one.
    text: z.string().min(1),
    usage: z.strictObject({ inputTokens: Tokens, outputTokens: Tokens, totalTokens: Tokens }),
    latencyMs: z.number().nonnegative().optional(),
    // Set when the provider refused the call with an error other than a 429, for example an
    // answer that failed the schema; a replay fails the extraction the same way. Recorded by the
    // T16 evals, where an injected item can make the model refuse.
    failure: z.strictObject({ status: z.int().nullable(), message: z.string().min(1) }).optional(),
  }),
});
export type ModelRecording = z.infer<typeof ModelRecording>;

export function modelRecordingPath(externalId: string, dir = RECORDINGS_DIR): string {
  return join(dir, 'models', `${AlpacaNewsId.parse(externalId)}.json`);
}

// null when the item has no model recording.
export async function loadModelRecording(
  externalId: string,
  dir = RECORDINGS_DIR,
): Promise<ModelRecording | null> {
  let contents: string;
  try {
    contents = await readFile(modelRecordingPath(externalId, dir), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  const recording = ModelRecording.parse(JSON.parse(contents));
  if (recording.externalId !== externalId) {
    throw new Error(`model recording ${externalId} holds item ${recording.externalId}`);
  }
  return recording;
}
