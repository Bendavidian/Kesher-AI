import { z } from 'zod';
import { Id } from './domain/common';

// POST /dev/replay/:sourceId (docs/INTERFACES.md, REST; development only). The created flags
// are false when a replay found the Source or the MarketEvent already stored.
export const ReplayResponse = z.strictObject({
  sourceId: Id,
  eventId: Id,
  sourceCreated: z.boolean(),
  eventCreated: z.boolean(),
});
export type ReplayResponse = z.infer<typeof ReplayResponse>;
