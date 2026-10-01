import { z } from 'zod';
import { Id } from './common';

// Why an item was counted instead of processed (SPEC.md Pipeline). The pre filter drops
// not_in_universe, duplicate and update before any model call. Live ingestion adds three
// (SPEC.md decision log, T19): queue_full, a waiting item the bounded live queue shed;
// daily_cap, a live news item past the day's extraction cap; extraction_failed, an item whose
// extraction failed its schema on both providers and stays stored to resume on the next try.
export const DropReason = z.enum([
  'not_in_universe',
  'duplicate',
  'update',
  'queue_full',
  'daily_cap',
  'extraction_failed',
]);
export type DropReason = z.infer<typeof DropReason>;

// Live items come from the providers; replayed items are the demo and the evals. Their counters
// are kept apart so replays never inflate the savings.
export const IngestMode = z.enum(['live', 'replay']);
export type IngestMode = z.infer<typeof IngestMode>;

// Counted items per UTC day, mode and reason. A dropped item is never stored; only this count is.
export const IngestCounter = z.strictObject({
  _id: Id,
  day: z.iso.date(),
  mode: IngestMode,
  reason: DropReason,
  count: z.int().positive(),
  updatedAt: z.date(),
});
export type IngestCounter = z.infer<typeof IngestCounter>;

// Live news extractions reserved per UTC day, against the daily cap that keeps live ingestion
// inside Groq's free tokens (SPEC.md decision log, T19). Replay, the demo library and research
// never reserve here.
export const IngestBudgetDay = z.strictObject({
  _id: Id,
  day: z.iso.date(),
  extractions: z.int().min(0),
  updatedAt: z.date(),
});
export type IngestBudgetDay = z.infer<typeof IngestBudgetDay>;
