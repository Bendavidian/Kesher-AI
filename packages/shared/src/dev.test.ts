import { describe, expect, it } from 'vitest';
import { ReplayResponse } from './dev';

describe('ReplayResponse', () => {
  const response = {
    sourceId: '00000000-0000-4000-8000-000000000001',
    eventId: '00000000-0000-4000-8000-000000000002',
    sourceCreated: true,
    eventCreated: false,
  };

  it('accepts ids and created flags', () => {
    expect(ReplayResponse.parse(response)).toEqual(response);
  });

  it('rejects a provider id in place of a Source id, and unknown keys', () => {
    expect(ReplayResponse.safeParse({ ...response, sourceId: '38062166' }).success).toBe(false);
    expect(ReplayResponse.safeParse({ ...response, userId: response.sourceId }).success).toBe(
      false,
    );
  });
});
