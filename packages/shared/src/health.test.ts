import { describe, expect, it } from 'vitest';
import { HealthResponse } from './health';

describe('HealthResponse', () => {
  it('accepts an ok status with demo mode on or off', () => {
    for (const demoMode of [true, false]) {
      expect(HealthResponse.parse({ status: 'ok', demoMode })).toEqual({ status: 'ok', demoMode });
    }
  });

  it('rejects any other status', () => {
    expect(HealthResponse.safeParse({ status: 'down', demoMode: false }).success).toBe(false);
  });

  it('rejects a missing status or demo mode', () => {
    expect(HealthResponse.safeParse({ demoMode: false }).success).toBe(false);
    expect(HealthResponse.safeParse({ status: 'ok' }).success).toBe(false);
  });
});
