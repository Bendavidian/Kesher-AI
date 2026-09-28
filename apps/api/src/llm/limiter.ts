import { setTimeout as delay } from 'node:timers/promises';

// Free tier limits of one model (docs/SPIKE.md, Console numbers).
export interface ModelLimits {
  rpm: number;
  tpm: number;
}

export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const systemClock: Clock = { now: () => Date.now(), sleep: (ms) => delay(ms) };

const WINDOW_MS = 60_000;

export interface Reservation {
  // Replaces the estimate with the tokens the provider reported. Unknown usage keeps the estimate.
  settle(actualTokens: number | undefined): void;
}

// Keeps one model's calls inside its requests and tokens per minute over a sliding 60 second
// window, so the free tier answers instead of returning a 429. Callers reserve an estimate before
// the call and settle it with the real usage afterwards. One process, so no locking is needed.
export class RateLimiter {
  private readonly calls: { at: number; tokens: number }[] = [];
  private blockedUntil = 0;

  constructor(
    private readonly limits: ModelLimits,
    private readonly clock: Clock = systemClock,
  ) {}

  async acquire(estimate: number): Promise<Reservation> {
    if (estimate > this.limits.tpm) {
      throw new Error(`a call of ${estimate} tokens exceeds ${this.limits.tpm} tokens per minute`);
    }
    for (;;) {
      const wait = this.waitFor(estimate);
      if (wait <= 0) break;
      await this.clock.sleep(wait);
    }
    const call = { at: this.clock.now(), tokens: estimate };
    this.calls.push(call);
    return {
      settle: (actual) => {
        if (actual !== undefined) call.tokens = actual;
      },
    };
  }

  // After a 429: no call until the time the provider asked for.
  block(until: number): void {
    this.blockedUntil = Math.max(this.blockedUntil, until);
  }

  isBlocked(): boolean {
    return this.clock.now() < this.blockedUntil;
  }

  // Whether a call of this size could start now. Reserves nothing.
  hasRoom(tokens: number): boolean {
    return tokens <= this.limits.tpm && this.waitFor(tokens) <= 0;
  }

  // Milliseconds until a call of this size fits, 0 when it fits now.
  private waitFor(tokens: number): number {
    const now = this.clock.now();
    while (this.calls.length > 0 && this.calls[0]!.at <= now - WINDOW_MS) this.calls.shift();
    let wait = this.blockedUntil - now;
    if (this.calls.length >= this.limits.rpm) {
      const frees = this.calls[this.calls.length - this.limits.rpm]!;
      wait = Math.max(wait, frees.at + WINDOW_MS - now);
    }
    let used = this.calls.reduce((sum, call) => sum + call.tokens, 0);
    for (const call of this.calls) {
      if (used + tokens <= this.limits.tpm) break;
      used -= call.tokens;
      wait = Math.max(wait, call.at + WINDOW_MS - now);
    }
    return wait;
  }
}
