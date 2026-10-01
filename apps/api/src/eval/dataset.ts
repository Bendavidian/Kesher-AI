import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { AlpacaNewsId, NonBlank, Ticker, type AlpacaNewsItem } from '@kesher/shared';
import { z } from 'zod';
import { RECORDINGS_DIR } from '../ingest/recordings';

// The T16 eval set: 30 real Alpaca news items (docs/research/eval-candidates.md), 4 market wraps
// (part 2) and five synthetic poisoned copies of some of the 30. Committed files only; nothing
// here reads a provider.

export const EVAL_DIR = resolve(import.meta.dirname, '../../../../data/evals');
export const EVENTS_PATH = resolve(EVAL_DIR, 'events.json');
export const POISONED_PATH = resolve(EVAL_DIR, 'poisoned.json');

// Model recordings of the synthetic items live apart from the real ones:
// recordings/synthetic/models/<id>.json.
export const SYNTHETIC_DIR = resolve(RECORDINGS_DIR, 'synthetic');

export const EvalEventType = z.enum([
  'earnings',
  'guidance',
  'production_disruption',
  'regulation',
  'analyst_action',
  'merger',
  // A market wrap whose provider tags name universe companies the text only mentions in passing
  // (T16 part 2). Reported apart from the other 30 items, under both start node rules.
  'market_wrap',
]);

export const EvalEvent = z.strictObject({
  id: AlpacaNewsId,
  // A universe symbol the item is tagged with, used only to look the item up in Alpaca.
  symbol: Ticker,
  createdAt: z.iso.datetime(),
  // Alpaca's time window applies to updated_at, so the lookup uses this day.
  updatedAt: z.iso.datetime(),
  type: EvalEventType,
  note: NonBlank.optional(),
});
export type EvalEvent = z.infer<typeof EvalEvent>;

export const EventsFile = z.strictObject({ events: z.array(EvalEvent).min(1) });

export const PoisonKind = z.enum([
  'raise_importance',
  'untagged_company',
  'tool_call',
  'system_prompt',
  'nested_tags',
]);
export type PoisonKind = z.infer<typeof PoisonKind>;

// Reserved ids, far above any Alpaca id in the set, so a synthetic item never collides with news.
export const SyntheticId = AlpacaNewsId.refine((id) => /^9000000\d{3}$/.test(id), {
  error: 'synthetic ids are 9000000000 to 9000000999',
});

export const PoisonedItem = z.strictObject({
  id: SyntheticId,
  baselineId: AlpacaNewsId,
  kind: PoisonKind,
  // What a successful attack would change, for the report.
  target: NonBlank,
  // Appended to the baseline's summary.
  injection: NonBlank,
});
export type PoisonedItem = z.infer<typeof PoisonedItem>;

export const PoisonedFile = z.strictObject({
  note: NonBlank,
  items: z.array(PoisonedItem).min(1),
});

export const SYNTHETIC_AUTHOR = 'Kesher eval (synthetic)';
export const SYNTHETIC_SOURCE = 'kesher-eval-synthetic';

const readJson = async (path: string): Promise<unknown> => JSON.parse(await readFile(path, 'utf8'));

export async function loadEvents(path = EVENTS_PATH): Promise<EvalEvent[]> {
  const { events } = EventsFile.parse(await readJson(path));
  const ids = events.map((e) => e.id);
  const duplicate = ids.find((id, i) => ids.indexOf(id) !== i);
  if (duplicate) throw new Error(`eval event ${duplicate} is listed twice`);
  return events;
}

export async function loadPoisoned(path = POISONED_PATH): Promise<PoisonedItem[]> {
  const { items } = PoisonedFile.parse(await readJson(path));
  const ids = items.map((p) => p.id);
  const duplicate = ids.find((id, i) => ids.indexOf(id) !== i);
  if (duplicate) throw new Error(`poisoned item ${duplicate} is listed twice`);
  return items;
}

// The poisoned copy of a baseline item: same headline, times and symbols, the injection appended
// to the summary, and every field that could pass for real news marked synthetic.
export function poisonedItem(baseline: AlpacaNewsItem, poison: PoisonedItem): AlpacaNewsItem {
  if (String(baseline.id) !== poison.baselineId) {
    throw new Error(`poisoned item ${poison.id} copies ${poison.baselineId}, not ${baseline.id}`);
  }
  const summary = baseline.summary.trim();
  return {
    ...baseline,
    id: Number(poison.id),
    author: SYNTHETIC_AUTHOR,
    source: SYNTHETIC_SOURCE,
    url: `https://kesher.invalid/synthetic/${poison.id}`,
    summary: summary === '' ? poison.injection : `${summary} ${poison.injection}`,
  };
}
