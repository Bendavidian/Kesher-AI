import { describe, expect, it } from 'vitest';
import { DemoReplayResponse, ReplayResponse, ResetResponse } from './dev';

describe('ReplayResponse', () => {
  const ids = {
    sourceId: '00000000-0000-4000-8000-000000000001',
    eventId: '00000000-0000-4000-8000-000000000002',
  };
  const processed = { outcome: 'processed', ...ids, sourceCreated: true, eventCreated: false };

  it('accepts a processed item with ids and created flags', () => {
    expect(ReplayResponse.parse(processed)).toEqual(processed);
  });

  it('accepts a not_in_universe drop without ids', () => {
    const dropped = { outcome: 'dropped', reason: 'not_in_universe' };
    expect(ReplayResponse.parse(dropped)).toEqual(dropped);
    expect(ReplayResponse.safeParse({ ...dropped, ...ids }).success).toBe(false);
  });

  it('requires the stored ids on a duplicate or update drop', () => {
    for (const reason of ['duplicate', 'update']) {
      expect(ReplayResponse.safeParse({ outcome: 'dropped', reason, ...ids }).success).toBe(true);
      expect(ReplayResponse.safeParse({ outcome: 'dropped', reason }).success).toBe(false);
    }
  });

  it('rejects a provider id in place of a Source id, and unknown keys', () => {
    expect(ReplayResponse.safeParse({ ...processed, sourceId: '38062166' }).success).toBe(false);
    expect(ReplayResponse.safeParse({ ...processed, userId: ids.sourceId }).success).toBe(false);
  });
});

describe('ResetResponse', () => {
  const ids = {
    sourceId: '00000000-0000-4000-8000-000000000001',
    eventId: '00000000-0000-4000-8000-000000000002',
  };

  it('names the item and counts the deleted FeedItems', () => {
    expect(ResetResponse.parse({ ...ids, deleted: 3 })).toEqual({ ...ids, deleted: 3 });
    expect(ResetResponse.safeParse({ ...ids, deleted: -1 }).success).toBe(false);
    expect(ResetResponse.safeParse({ ...ids, deleted: 1.5 }).success).toBe(false);
  });
});

describe('DemoReplayResponse', () => {
  const ids = {
    sourceId: '00000000-0000-4000-8000-000000000001',
    eventId: '00000000-0000-4000-8000-000000000002',
  };
  const replay = { outcome: 'processed', ...ids, sourceCreated: false, eventCreated: false };

  it('carries the reset, or null when there was nothing to reset, and the replay', () => {
    const reset = { ...ids, deleted: 3 };
    expect(DemoReplayResponse.parse({ reset, replay })).toEqual({ reset, replay });
    expect(DemoReplayResponse.parse({ reset: null, replay })).toEqual({ reset: null, replay });
  });

  it('rejects a missing replay and unknown keys', () => {
    expect(DemoReplayResponse.safeParse({ reset: null }).success).toBe(false);
    expect(
      DemoReplayResponse.safeParse({ reset: null, replay, sourceId: '38062166' }).success,
    ).toBe(false);
  });
});
