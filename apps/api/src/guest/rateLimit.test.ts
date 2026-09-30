import { describe, expect, it } from 'vitest';
import { clientKey, createRateLimiter } from './rateLimit';

describe('createRateLimiter', () => {
  it('allows limit takes per key in a window, then says when to retry', () => {
    let at = 0;
    const limiter = createRateLimiter({ limit: 2, windowMs: 60_000, now: () => at });
    expect(limiter.take('a')).toEqual({ ok: true });
    at = 10_000;
    expect(limiter.take('a')).toEqual({ ok: true });
    expect(limiter.take('a')).toEqual({ ok: false, retryAfterSeconds: 50 });
    expect(limiter.take('b')).toEqual({ ok: true });
    at = 60_000;
    expect(limiter.take('a')).toEqual({ ok: true });
  });

  it('gives a take back', () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000, now: () => 0 });
    expect(limiter.take('a')).toEqual({ ok: true });
    limiter.refund('a');
    expect(limiter.take('a')).toEqual({ ok: true });
    expect(limiter.take('a').ok).toBe(false);
  });
});

describe('clientKey', () => {
  it('keeps IPv4, maps IPv4 in IPv6, and keys IPv6 by its /64', () => {
    expect(clientKey('203.0.113.7')).toBe('203.0.113.7');
    expect(clientKey('::ffff:203.0.113.7')).toBe('203.0.113.7');
    expect(clientKey('2001:db8:1:2:aaaa::1')).toBe('2001:db8:1:2::/64');
    expect(clientKey('2001:0db8:0001:0002:ffff:ffff:ffff:ffff')).toBe('2001:db8:1:2::/64');
    expect(clientKey('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(clientKey('::1')).toBe('0:0:0:0::/64');
    expect(clientKey(undefined)).toBe('unknown');
  });
});
