import type { AlpacaNewsItem } from '@kesher/shared';
import { recordModels } from '../extract/recordModels';
import { writeJson } from '../graph/json';
import { fetchAlpacaNewsById, toIncomingItem, type AlpacaKeys } from '../ingest/alpaca';
import { loadRecording, Recording, recordingPath, RECORDINGS_DIR } from '../ingest/recordings';
import type { ModelClient } from '../llm/client';
import { loadModelRecording, modelRecordingPath, type ModelRecording } from '../llm/recordings';
import { poisonedItem, SYNTHETIC_DIR, type EvalEvent, type PoisonedItem } from './dataset';

// One item of an eval run: a real recorded news item, or a synthetic poisoned copy of one.
export type EvalItem =
  | { kind: 'real'; id: string; event: EvalEvent; item: AlpacaNewsItem }
  | { kind: 'poisoned'; id: string; poison: PoisonedItem; item: AlpacaNewsItem };

// Real model recordings live in recordings/models, synthetic ones in recordings/synthetic/models.
const modelsDir = (item: EvalItem) => (item.kind === 'real' ? RECORDINGS_DIR : SYNTHETIC_DIR);

export const modelsPathOf = (item: EvalItem) => modelRecordingPath(item.id, modelsDir(item));

export const loadModelsOf = (item: EvalItem): Promise<ModelRecording | null> =>
  loadModelRecording(item.id, modelsDir(item));

// The items with a recording, and the ids of the real items that have none yet. A poisoned item
// is built from its baseline's recording, so it is missing exactly when its baseline is.
export async function loadEvalItems(
  events: readonly EvalEvent[],
  poisoned: readonly PoisonedItem[],
): Promise<{ items: EvalItem[]; missing: string[] }> {
  const items: EvalItem[] = [];
  const missing: string[] = [];
  const real = new Map<string, AlpacaNewsItem>();
  for (const event of events) {
    const recording = await loadRecording(event.id);
    if (!recording) {
      missing.push(event.id);
      continue;
    }
    real.set(event.id, recording.item);
    items.push({ kind: 'real', id: event.id, event, item: recording.item });
  }
  for (const poison of poisoned) {
    const baseline = real.get(poison.baselineId);
    if (!baseline) continue;
    items.push({ kind: 'poisoned', id: poison.id, poison, item: poisonedItem(baseline, poison) });
  }
  return { items, missing };
}

// npm run eval -- --record: fetches the Alpaca items that have no recording, once.
export async function recordAlpacaItems(
  events: readonly EvalEvent[],
  ids: readonly string[],
  keys: AlpacaKeys,
  log: (message: string) => void,
): Promise<void> {
  for (const id of ids) {
    const event = events.find((e) => e.id === id)!;
    const raw = await fetchAlpacaNewsById({
      id: Number(id),
      symbol: event.symbol,
      date: event.updatedAt.slice(0, 10),
      keys,
    });
    const recording = Recording.parse({
      provider: 'alpaca',
      recordedAt: new Date().toISOString(),
      item: raw,
    });
    await writeJson(recordingPath(id), recording);
    log(`Recorded Alpaca news ${id}.`);
  }
}

// npm run eval -- --record: runs the screen and the extraction for real, once, on every item
// that has no model recording, on the free tiers.
export async function recordModelAnswers(
  items: readonly EvalItem[],
  client: ModelClient,
  waitedMs: () => number,
  log: (message: string) => void,
): Promise<void> {
  for (const item of items) {
    if (await loadModelsOf(item)) continue;
    const recording = await recordModels(client, item.id, toIncomingItem(item.item), { waitedMs });
    await writeJson(modelsPathOf(item), recording);
    log(
      `Recorded models for ${item.kind} ${item.id}: ${recording.extraction.provider} ${recording.extraction.model}, ${recording.extraction.usage.totalTokens ?? '?'} tokens.`,
    );
  }
}
