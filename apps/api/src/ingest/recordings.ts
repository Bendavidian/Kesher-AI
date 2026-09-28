import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { AlpacaNewsItem } from './alpaca';

// Committed recordings at the repo root, from apps/api/src/ingest: recordings/<provider>/<id>.json.
// Replay reads them by id, so the demo and the evals never depend on a provider being up.
export const RECORDINGS_DIR = resolve(import.meta.dirname, '../../../../recordings');

// The raw provider item, without the full article content.
export const Recording = z.strictObject({
  provider: z.literal('alpaca'),
  recordedAt: z.iso.datetime(),
  item: AlpacaNewsItem,
});
export type Recording = z.infer<typeof Recording>;

// An Alpaca news id. Digits only, so an id can never step outside the recordings directory.
export const AlpacaNewsId = z.string().regex(/^\d{1,20}$/);

export function recordingPath(externalId: string, dir = RECORDINGS_DIR): string {
  return join(dir, 'alpaca', `${AlpacaNewsId.parse(externalId)}.json`);
}

// null when no recording exists for the id. A file that fails its schema, or holds another
// id, throws.
export async function loadRecording(
  externalId: string,
  dir = RECORDINGS_DIR,
): Promise<Recording | null> {
  let contents: string;
  try {
    contents = await readFile(recordingPath(externalId, dir), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  const recording = Recording.parse(JSON.parse(contents));
  if (String(recording.item.id) !== externalId) {
    throw new Error(`recording ${externalId} holds item ${recording.item.id}`);
  }
  return recording;
}
