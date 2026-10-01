import { z } from 'zod';
import { DropReason } from './domain/ingest';

// The Alpaca news stream as the live process sees it. connecting: a socket is open and not yet
// subscribed; reconnecting: waiting for the next attempt; stopped: for good (bad keys, a plan
// without news, or shutdown). since is when it entered that state.
export const StreamState = z.enum(['connecting', 'subscribed', 'reconnecting', 'stopped']);
export type StreamState = z.infer<typeof StreamState>;

// What the api process running live ingestion knows about itself. A source is null when it was
// not started.
export const LiveStatus = z.strictObject({
  stream: z
    .strictObject({ state: StreamState, since: z.date(), lastMessageAt: z.date().nullable() })
    .nullable(),
  edgar: z
    .strictObject({ lastPollAt: z.date().nullable(), pausedUntil: z.date().nullable() })
    .nullable(),
  queue: z.strictObject({
    waiting: z.int().min(0),
    running: z.boolean(),
    limit: z.int().positive(),
  }),
});
export type LiveStatus = z.infer<typeof LiveStatus>;

// GET /ingest/status (docs/INTERFACES.md, REST): live is null where LIVE_INGEST is off in the
// answering process. lastItemAt is when the newest live item was recorded, by any machine on the
// database. today holds the UTC day's live extractions against the cap and its live counters.
export const IngestStatus = z.strictObject({
  live: LiveStatus.nullable(),
  lastItemAt: z.date().nullable(),
  today: z.strictObject({
    day: z.iso.date(),
    extractions: z.strictObject({ used: z.int().min(0), limit: z.int().positive() }),
    counters: z.array(z.strictObject({ reason: DropReason, count: z.int().positive() })),
  }),
});
export type IngestStatus = z.infer<typeof IngestStatus>;
