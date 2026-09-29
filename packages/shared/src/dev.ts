import { z } from 'zod';
import { Id } from './domain/common';

// POST /dev/replay/:sourceId (docs/INTERFACES.md, REST; development only).
// processed: the item passed the pre filter and now has an extraction. The created flags are
// false when a replay resumed a Source or MarketEvent that was already stored.
// dropped: the pre filter stopped it before any model call. not_in_universe stores nothing;
// duplicate and update name the Source and MarketEvent that were already processed.
const ReplayDropped = z.discriminatedUnion('reason', [
  z.strictObject({
    outcome: z.literal('dropped'),
    reason: z.literal('not_in_universe'),
  }),
  z.strictObject({
    outcome: z.literal('dropped'),
    reason: z.enum(['duplicate', 'update']),
    sourceId: Id,
    eventId: Id,
  }),
]);

export const ReplayResponse = z.discriminatedUnion('outcome', [
  z.strictObject({
    outcome: z.literal('processed'),
    sourceId: Id,
    eventId: Id,
    sourceCreated: z.boolean(),
    eventCreated: z.boolean(),
  }),
  ReplayDropped,
]);
export type ReplayResponse = z.infer<typeof ReplayResponse>;

// POST /dev/reset/:sourceId (development only): deletes the FeedItems of the item's event and
// nothing else, so the next replay scores it again with no model call and pushes it as new.
export const ResetResponse = z.strictObject({
  sourceId: Id,
  eventId: Id,
  deleted: z.int().min(0),
});
export type ResetResponse = z.infer<typeof ResetResponse>;
