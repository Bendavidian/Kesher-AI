import type { IngestStatus } from '@kesher/shared';
import { describe, expect, it } from 'vitest';
import { ingestView } from './ingest';

// 10:02 ET on a weekday.
const at = new Date('2026-10-01T14:02:00Z');

const today: IngestStatus['today'] = {
  day: '2026-10-01',
  extractions: { used: 41, limit: 150 },
  counters: [
    { reason: 'daily_cap', count: 2 },
    { reason: 'not_in_universe', count: 812 },
  ],
};

const live: NonNullable<IngestStatus['live']> = {
  stream: { state: 'subscribed', since: at, lastMessageAt: at },
  edgar: { lastPollAt: at, pausedUntil: null },
  queue: { waiting: 3, running: true, limit: 50 },
};

describe('ingestView', () => {
  it('says live ingestion is off where it does not run, with the last item any machine had', () => {
    expect(ingestView({ live: null, lastItemAt: at, today }).summary).toBe(
      'Live ingest off · last item Oct 1, 10:02 ET',
    );
    expect(ingestView({ live: null, lastItemAt: null, today }).summary).toBe('Live ingest off');
  });

  it('sums up the stream, the last item, the queue and the day against the cap', () => {
    expect(ingestView({ live, lastItemAt: at, today }).summary).toBe(
      'Live · connected · last item Oct 1, 10:02 ET · queue 3 · 41 of 150 extracted',
    );
  });

  it.each([
    ['connecting', 'connecting'],
    ['reconnecting', 'reconnecting'],
    ['stopped', 'stream stopped'],
  ] as const)('names a stream that is %s', (state, label) => {
    const status = {
      live: { ...live, stream: { ...live.stream!, state } },
      lastItemAt: null,
      today,
    };
    expect(ingestView(status).summary).toBe(`Live · ${label} · queue 3 · 41 of 150 extracted`);
  });

  it('lists the day, the queue, the poller and each counter by name', () => {
    expect(ingestView({ live, lastItemAt: at, today }).rows).toEqual([
      { label: 'Extractions today (UTC)', value: '41 of 150' },
      { label: 'Queue', value: '3 waiting, 1 running, at most 50' },
      { label: 'EDGAR', value: 'last poll Oct 1, 10:02 ET' },
      { label: 'Past the daily cap', value: '2' },
      { label: 'Outside the universe', value: '812' },
    ]);
  });

  it('says when EDGAR is paused, and leaves the process rows out where live is off', () => {
    const paused = { ...live, edgar: { lastPollAt: null, pausedUntil: at } };
    expect(ingestView({ live: paused, lastItemAt: null, today }).rows[2]).toEqual({
      label: 'EDGAR',
      value: 'paused until Oct 1, 10:02 ET',
    });
    expect(
      ingestView({ live: null, lastItemAt: null, today: { ...today, counters: [] } }).rows,
    ).toEqual([{ label: 'Extractions today (UTC)', value: '41 of 150' }]);
  });
});
