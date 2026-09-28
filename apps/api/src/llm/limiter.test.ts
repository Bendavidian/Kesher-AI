import { describe, expect, it } from 'vitest';
import { RateLimiter, type Clock } from './limiter';

// Time only moves when the limiter sleeps, so every wait is exact.
function fakeClock(start = 0): Clock & { slept: number[] } {
  let now = start;
  const slept: number[] = [];
  return {
    slept,
    now: () => now,
    sleep: (ms) => {
      slept.push(ms);
      now += ms;
      return Promise.resolve();
    },
  };
}

describe('RateLimiter', () => {
  it('passes calls that fit in the window without waiting', async () => {
    const clock = fakeClock();
    const limiter = new RateLimiter({ rpm: 30, tpm: 8_000 }, clock);

    await limiter.acquire(3_000);
    await limiter.acquire(3_000);

    expect(clock.slept).toEqual([]);
  });

  it('waits for tokens to leave the 60 second window when TPM is full', async () => {
    const clock = fakeClock();
    const limiter = new RateLimiter({ rpm: 30, tpm: 8_000 }, clock);

    await limiter.acquire(5_000);
    await clock.sleep(10_000);
    await limiter.acquire(2_000);
    clock.slept.length = 0;
    await limiter.acquire(2_000);

    // 9,000 tokens do not fit, so the first 5,000 must age out at t = 60 s.
    expect(clock.slept).toEqual([50_000]);
    expect(clock.now()).toBe(60_000);
  });

  it('waits when RPM is full', async () => {
    const clock = fakeClock();
    const limiter = new RateLimiter({ rpm: 2, tpm: 100_000 }, clock);

    await limiter.acquire(10);
    await clock.sleep(1_000);
    await limiter.acquire(10);
    clock.slept.length = 0;
    await limiter.acquire(10);

    expect(clock.slept).toEqual([59_000]);
  });

  it('settles a reservation to the tokens actually used', async () => {
    const clock = fakeClock();
    const limiter = new RateLimiter({ rpm: 30, tpm: 8_000 }, clock);

    const reservation = await limiter.acquire(6_000);
    reservation.settle(900);
    await limiter.acquire(6_000);

    expect(clock.slept).toEqual([]);
  });

  it('keeps the estimate when the actual usage is unknown', async () => {
    const clock = fakeClock();
    const limiter = new RateLimiter({ rpm: 30, tpm: 8_000 }, clock);

    (await limiter.acquire(6_000)).settle(undefined);

    expect(limiter.hasRoom(6_000)).toBe(false);
  });

  it('waits out a block set after a 429', async () => {
    const clock = fakeClock(1_000);
    const limiter = new RateLimiter({ rpm: 30, tpm: 8_000 }, clock);

    limiter.block(21_000);
    expect(limiter.isBlocked()).toBe(true);
    await limiter.acquire(100);

    expect(clock.slept).toEqual([20_000]);
    expect(limiter.isBlocked()).toBe(false);
  });

  it('reports room for a budget without reserving it', async () => {
    const clock = fakeClock();
    const limiter = new RateLimiter({ rpm: 30, tpm: 8_000 }, clock);

    await limiter.acquire(3_000);

    expect(limiter.hasRoom(5_000)).toBe(true);
    expect(limiter.hasRoom(5_001)).toBe(false);
    limiter.block(1);
    expect(limiter.hasRoom(10)).toBe(false);
  });

  it('rejects a call larger than the whole minute', async () => {
    const limiter = new RateLimiter({ rpm: 30, tpm: 8_000 }, fakeClock());
    await expect(limiter.acquire(8_001)).rejects.toThrow(/exceeds/);
  });
});
