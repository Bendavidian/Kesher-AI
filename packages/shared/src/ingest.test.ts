import { describe, expect, it } from 'vitest';
import { IngestStatus } from './ingest';

const at = new Date('2026-10-01T14:00:00Z');

const today = {
  day: '2026-10-01',
  extractions: { used: 41, limit: 150 },
  counters: [
    { reason: 'not_in_universe', count: 812 },
    { reason: 'daily_cap', count: 2 },
  ],
};

const live = {
  stream: { state: 'subscribed', since: at, lastMessageAt: at },
  edgar: { lastPollAt: at, pausedUntil: null },
  queue: { waiting: 0, running: false, limit: 50 },
};

describe('IngestStatus', () => {
  it('accepts a live process with its stream, poller, queue and today', () => {
    expect(IngestStatus.safeParse({ live, lastItemAt: at, today }).success).toBe(true);
  });

  it('accepts a process with live ingestion off and nothing recorded', () => {
    const off = { live: null, lastItemAt: null, today: { ...today, counters: [] } };
    expect(IngestStatus.safeParse(off).success).toBe(true);
  });

  it('accepts a live process whose sources are off', () => {
    const sourcesOff = { ...live, stream: null, edgar: null };
    expect(IngestStatus.safeParse({ live: sourcesOff, lastItemAt: null, today }).success).toBe(
      true,
    );
  });

  it('rejects an unknown stream state, an unknown reason and a negative queue', () => {
    const state = { ...live, stream: { ...live.stream, state: 'open' } };
    expect(IngestStatus.safeParse({ live: state, lastItemAt: at, today }).success).toBe(false);
    const reason = { ...today, counters: [{ reason: 'spam', count: 1 }] };
    expect(IngestStatus.safeParse({ live, lastItemAt: at, today: reason }).success).toBe(false);
    const queue = { ...live, queue: { ...live.queue, waiting: -1 } };
    expect(IngestStatus.safeParse({ live: queue, lastItemAt: at, today }).success).toBe(false);
  });

  it('rejects a user id or any other field', () => {
    expect(IngestStatus.safeParse({ live, lastItemAt: at, today, userId: 'x' }).success).toBe(
      false,
    );
  });
});
