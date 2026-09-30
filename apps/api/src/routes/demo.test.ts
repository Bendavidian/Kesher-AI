import { describe, expect, it } from 'vitest';
import { createDemoLimiter } from './demo';

describe('createDemoLimiter', () => {
  it('lets one demo replay run at a time', () => {
    const limiter = createDemoLimiter({ cooldownMs: 15_000, now: () => 0 });
    const first = limiter.tryStart();
    expect(first.ok).toBe(true);
    expect(limiter.tryStart()).toEqual({ ok: false, status: 409 });
  });

  it('waits the cooldown after a replay ends, rounding the wait up to whole seconds', () => {
    let clock = 1_000;
    const limiter = createDemoLimiter({ cooldownMs: 15_000, now: () => clock });
    const first = limiter.tryStart();
    if (!first.ok) throw new Error('first start refused');
    clock = 5_000;
    first.done();

    clock = 5_001;
    expect(limiter.tryStart()).toEqual({ ok: false, status: 429, retryAfterSeconds: 15 });
    clock = 19_500;
    expect(limiter.tryStart()).toEqual({ ok: false, status: 429, retryAfterSeconds: 1 });
    clock = 20_000;
    expect(limiter.tryStart().ok).toBe(true);
  });

  it('starts the cooldown after a replay that failed too', () => {
    let clock = 0;
    const limiter = createDemoLimiter({ cooldownMs: 1_000, now: () => clock });
    const first = limiter.tryStart();
    if (!first.ok) throw new Error('first start refused');
    first.done();
    expect(limiter.tryStart()).toMatchObject({ ok: false, status: 429 });
    clock = 1_000;
    expect(limiter.tryStart().ok).toBe(true);
  });

  it('ignores a second done for the same start', () => {
    let clock = 0;
    const limiter = createDemoLimiter({ cooldownMs: 1_000, now: () => clock });
    const first = limiter.tryStart();
    if (!first.ok) throw new Error('first start refused');
    first.done();
    clock = 1_000;
    const second = limiter.tryStart();
    expect(second.ok).toBe(true);
    first.done();
    expect(limiter.tryStart()).toEqual({ ok: false, status: 409 });
  });
});
