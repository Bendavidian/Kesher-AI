import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Id, LlmProvider } from '@kesher/shared';
import { z } from 'zod';
import { AlpacaNewsId, RECORDINGS_DIR } from '../ingest/recordings';

const Tokens = z.int().nonnegative().nullable();

// One raw model turn of a research run, exactly as the provider answered.
export const RecordedTurn = z.strictObject({
  text: z.string(),
  // input is the raw JSON the model sent.
  toolCalls: z.array(
    z.strictObject({
      toolCallId: z.string().min(1),
      toolName: z.string().min(1),
      input: z.string(),
    }),
  ),
  finishReason: z.string(),
  usage: z.strictObject({ inputTokens: Tokens, outputTokens: Tokens, totalTokens: Tokens }),
});
export type RecordedTurn = z.infer<typeof RecordedTurn>;

// One raw verifier call: the answer text as the provider sent it, or the error that ended it.
export const RecordedVerifierCall = z.union([
  z.strictObject({
    text: z.string(),
    usage: z.strictObject({ inputTokens: Tokens, outputTokens: Tokens, totalTokens: Tokens }),
  }),
  z.strictObject({ error: z.string().min(1) }),
]);
export type RecordedVerifierCall = z.infer<typeof RecordedVerifierCall>;

// A real research run on a recorded item, recordings/research/<alpaca id>.json, written by
// npm run research:dev -- --record. Tests replay the turns through mock models, so no test calls
// a provider. ids are the Atlas documents the run used; tests store the item under them, so the
// recorded tool calls and cited source ids resolve.
export const ResearchRecording = z.strictObject({
  externalId: AlpacaNewsId,
  recordedAt: z.iso.datetime(),
  persona: z.enum(['A', 'B', 'C']),
  mode: z.enum(['auto', 'deep']),
  provider: LlmProvider,
  model: z.string().min(1),
  ids: z.strictObject({ eventId: Id, sourceIds: z.array(Id).min(1) }),
  turns: z.array(RecordedTurn).min(1),
  // The verifier's calls after the report, in order. Missing in recordings made before T14.
  verifier: z.array(RecordedVerifierCall).optional(),
  // The price reaction the run's numbers_match read, as JSON (computed moves only, no bars), or
  // null when the report had no figures. Tests pass it back with reviveReaction.
  reaction: z.unknown().optional(),
});
export type ResearchRecording = z.infer<typeof ResearchRecording>;

export function researchRecordingPath(externalId: string, dir = RECORDINGS_DIR): string {
  return join(dir, 'research', `${AlpacaNewsId.parse(externalId)}.json`);
}

// null when the item has no research recording.
export async function loadResearchRecording(
  externalId: string,
  dir = RECORDINGS_DIR,
): Promise<ResearchRecording | null> {
  const path = researchRecordingPath(externalId, dir);
  if (!existsSync(path)) return null;
  const recording = ResearchRecording.parse(JSON.parse(await readFile(path, 'utf8')));
  if (recording.externalId !== externalId) {
    throw new Error(`research recording ${externalId} holds item ${recording.externalId}`);
  }
  return recording;
}
