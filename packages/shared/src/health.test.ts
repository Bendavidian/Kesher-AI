import { describe, expect, it } from 'vitest';
import { HealthResponse } from './health';

describe('HealthResponse', () => {
  it('accepts an ok status', () => {
    expect(HealthResponse.parse({ status: 'ok' })).toEqual({ status: 'ok' });
  });

  it('rejects any other status', () => {
    expect(HealthResponse.safeParse({ status: 'down' }).success).toBe(false);
  });

  it('rejects a missing status', () => {
    expect(HealthResponse.safeParse({}).success).toBe(false);
  });
});
