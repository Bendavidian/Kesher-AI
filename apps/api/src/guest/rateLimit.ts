// A fixed window count per key, in process: the deployed api is one instance (SPEC.md decision
// log, T18), and a restart only forgets the windows. Guest creation is keyed by client IP and
// holdings changes by guest (T24).
export type RateTake = { ok: true } | { ok: false; retryAfterSeconds: number };

export interface RateLimiter {
  take(key: string): RateTake;
  // Gives back one take of the key's current window, for a request that was refused later.
  refund(key: string): void;
}

// The key of a client address: an IPv4 address as it is, an IPv6 address by its /64 prefix,
// since one host usually holds a whole /64. An IPv4 mapped IPv6 address counts as IPv4.
export function clientKey(ip: string | undefined): string {
  if (!ip) return 'unknown';
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return mapped[1]!;
  if (!ip.includes(':')) return ip;
  const [head = '', tail = ''] = ip.split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups = ip.includes('::')
    ? [...left, ...Array<string>(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right]
    : left;
  return `${groups
    .slice(0, 4)
    .map((group) => group.toLowerCase().replace(/^0+(?=.)/, ''))
    .join(':')}::/64`;
}

export function createRateLimiter({
  limit,
  windowMs,
  now = Date.now,
}: {
  limit: number;
  windowMs: number;
  now?: () => number;
}): RateLimiter {
  const windows = new Map<string, { startedAt: number; count: number }>();
  return {
    take(key) {
      const at = now();
      // Windows that ended are dropped, so the map holds only the last window's keys.
      for (const [other, window] of windows) {
        if (at - window.startedAt >= windowMs) windows.delete(other);
      }
      const window = windows.get(key);
      if (!window) {
        windows.set(key, { startedAt: at, count: 1 });
        return { ok: true };
      }
      if (window.count >= limit) {
        return {
          ok: false,
          retryAfterSeconds: Math.ceil((window.startedAt + windowMs - at) / 1000),
        };
      }
      window.count += 1;
      return { ok: true };
    },
    refund(key) {
      const window = windows.get(key);
      if (window && window.count > 0) window.count -= 1;
    },
  };
}
