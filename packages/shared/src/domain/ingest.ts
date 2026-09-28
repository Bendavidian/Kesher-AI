import { z } from 'zod';
import { Id } from './common';

// Why the pre filter dropped an item before any model call (SPEC.md Pipeline).
export const DropReason = z.enum(['not_in_universe', 'duplicate', 'update']);
export type DropReason = z.infer<typeof DropReason>;

// Live items come from the providers; replayed items are the demo and the evals. Their counters
// are kept apart so replays never inflate the savings.
export const IngestMode = z.enum(['live', 'replay']);
export type IngestMode = z.infer<typeof IngestMode>;

// Dropped items per UTC day, mode and reason. A dropped item is never stored; only this count is.
export const IngestCounter = z.strictObject({
  _id: Id,
  day: z.iso.date(),
  mode: IngestMode,
  reason: DropReason,
  count: z.int().positive(),
  updatedAt: z.date(),
});
export type IngestCounter = z.infer<typeof IngestCounter>;
