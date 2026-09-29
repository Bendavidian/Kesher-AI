import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MissingModelKeyError } from '../llm/client';
import { rateLimitError } from '../test/models';
import { createIngestQueue } from './queue';

// A job with no await of its own.
const sync = (fn: () => unknown) => () => {
  fn();
  return Promise.resolve();
};

describe('createIngestQueue', () => {
  let logs: string[];
  const log = (message: string) => logs.push(message);

  beforeEach(() => {
    logs = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs one job at a time, in arrival order', async () => {
    const queue = createIngestQueue({ log });
    const events: string[] = [];
    let active = 0;
    const job = (name: string) => async () => {
      active++;
      expect(active).toBe(1);
      events.push(`start ${name}`);
      await new Promise((resolve) => setTimeout(resolve, 5));
      events.push(`end ${name}`);
      active--;
    };
    queue.push('a', job('a'));
    queue.push('b', job('b'));
    queue.push('c', job('c'));
    await queue.idle();
    expect(events).toEqual(['start a', 'end a', 'start b', 'end b', 'start c', 'end c']);
  });

  it('runs a waiting key once, with the newest job', async () => {
    const queue = createIngestQueue({ log });
    const ran: string[] = [];
    let release!: () => void;
    queue.push('first', () => new Promise<void>((resolve) => (release = resolve)));
    queue.push(
      'item',
      sync(() => ran.push('old')),
    );
    queue.push(
      'item',
      sync(() => ran.push('new')),
    );
    release();
    await queue.idle();
    expect(ran).toEqual(['new']);
  });

  it('never runs two jobs of one key side by side, even when the second arrives mid run', async () => {
    const queue = createIngestQueue({ log });
    const ran: string[] = [];
    let release!: () => void;
    queue.push('item', async () => {
      ran.push('v1 start');
      await new Promise<void>((resolve) => (release = resolve));
      ran.push('v1 end');
    });
    await Promise.resolve();
    queue.push(
      'item',
      sync(() => ran.push('v2')),
    );
    release();
    await queue.idle();
    expect(ran).toEqual(['v1 start', 'v1 end', 'v2']);
  });

  it('logs a failed job and goes on with the next', async () => {
    const queue = createIngestQueue({ log });
    const ran: string[] = [];
    queue.push('bad', () => Promise.reject(new Error('boom')));
    queue.push('key', () => Promise.reject(new MissingModelKeyError('GROQ_API_KEY')));
    queue.push(
      'good',
      sync(() => ran.push('good')),
    );
    await queue.idle();
    expect(ran).toEqual(['good']);
    expect(logs[0]).toMatch(/^live bad failed: Error: boom/);
    expect(logs[1]).toBe('live key: GROQ_API_KEY is not set');
  });

  it('retries a rate limited job after the wait, at most maxRetries times', async () => {
    vi.useFakeTimers();
    const queue = createIngestQueue({ log, retryDelayMs: 1_000, maxRetries: 2 });
    let calls = 0;
    queue.push('item', () => {
      calls++;
      return Promise.reject(rateLimitError(30));
    });
    await queue.idle();
    expect(calls).toBe(1);
    // The provider asked for 30 s, more than the 1 s floor.
    await vi.advanceTimersByTimeAsync(29_000);
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(1_000);
    await queue.idle();
    expect(calls).toBe(2);
    await vi.advanceTimersByTimeAsync(30_000);
    await queue.idle();
    expect(calls).toBe(3);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toBe(3);
    expect(logs.at(-1)).toBe('live item still rate limited after 2 retries; replay it later');
  });

  it('stop waits for the running job, drops the waiting ones and pending retries', async () => {
    vi.useFakeTimers();
    const queue = createIngestQueue({ log, retryDelayMs: 1_000 });
    const ran: string[] = [];
    queue.push('limited', () => {
      ran.push('limited');
      return Promise.reject(rateLimitError());
    });
    await queue.idle();
    let release!: () => void;
    queue.push('running', async () => {
      await new Promise<void>((resolve) => (release = resolve));
      ran.push('running');
    });
    queue.push(
      'waiting',
      sync(() => ran.push('waiting')),
    );
    await Promise.resolve();
    const stopped = queue.stop();
    release();
    await stopped;
    await vi.advanceTimersByTimeAsync(10_000);
    queue.push(
      'late',
      sync(() => ran.push('late')),
    );
    await queue.idle();
    expect(ran).toEqual(['limited', 'running']);
  });
});
