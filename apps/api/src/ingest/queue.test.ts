import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExtractionFailedError } from '../extract/extraction';
import { MissingModelKeyError } from '../llm/client';
import { rateLimitError } from '../test/models';
import { createIngestQueue, QUEUE_LIMIT } from './queue';

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

  it('logs nothing more for an extraction that failed its schema, which is counted already', async () => {
    const queue = createIngestQueue({ log });
    queue.push('item', () =>
      Promise.reject(new ExtractionFailedError({ provider: 'alpaca', externalId: '41000001' })),
    );
    await queue.idle();
    expect(logs).toEqual([]);
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

  describe('limit', () => {
    // A running job that holds the queue until released, so the next pushes wait.
    const hold = (queue: ReturnType<typeof createIngestQueue>) => {
      let release!: () => void;
      queue.push('running', () => new Promise<void>((resolve) => (release = resolve)));
      return () => release();
    };

    it('waits for at most 50 jobs by default', () => {
      expect(QUEUE_LIMIT).toBe(50);
      expect(createIngestQueue({ log }).status()).toEqual({
        waiting: 0,
        running: false,
        limit: 50,
      });
    });

    it('sheds the oldest waiting job when full, names it, and keeps the running one', async () => {
      const shed: string[] = [];
      const queue = createIngestQueue({ log, limit: 2, onShed: (key) => void shed.push(key) });
      const ran: string[] = [];
      const release = hold(queue);
      await Promise.resolve();
      for (const key of ['a', 'b', 'c']) {
        queue.push(
          key,
          sync(() => ran.push(key)),
        );
      }

      expect(queue.status()).toEqual({ waiting: 2, running: true, limit: 2 });
      expect(shed).toEqual(['a']);
      expect(logs).toEqual(['live queue full (2 waiting); dropped a']);
      release();
      await queue.idle();
      expect(ran).toEqual(['b', 'c']);
      expect(queue.status()).toEqual({ waiting: 0, running: false, limit: 2 });
    });

    it('sheds a job pushed with shedLast only when no other job waits', async () => {
      const shed: string[] = [];
      const queue = createIngestQueue({ log, limit: 2, onShed: (key) => void shed.push(key) });
      const release = hold(queue);
      await Promise.resolve();
      queue.push(
        'filing',
        sync(() => undefined),
        { shedLast: true },
      );
      queue.push(
        'news 1',
        sync(() => undefined),
      );
      queue.push(
        'news 2',
        sync(() => undefined),
      );
      expect(shed).toEqual(['news 1']);

      queue.push(
        'filing 2',
        sync(() => undefined),
        { shedLast: true },
      );
      queue.push(
        'filing 3',
        sync(() => undefined),
        { shedLast: true },
      );
      expect(shed).toEqual(['news 1', 'news 2', 'filing']);
      release();
      await queue.idle();
    });

    it('waits for at least one job whatever limit it is given', async () => {
      const shed: string[] = [];
      const queue = createIngestQueue({ log, limit: 0, onShed: (key) => void shed.push(key) });
      const release = hold(queue);
      await Promise.resolve();
      queue.push(
        'a',
        sync(() => undefined),
      );
      queue.push(
        'b',
        sync(() => undefined),
      );
      expect(shed).toEqual(['a']);
      expect(queue.status()).toMatchObject({ waiting: 1, limit: 1 });
      release();
      await queue.idle();
    });

    it('sheds nothing when a waiting key is pushed again', async () => {
      const shed: string[] = [];
      const queue = createIngestQueue({ log, limit: 1, onShed: (key) => void shed.push(key) });
      const release = hold(queue);
      await Promise.resolve();
      queue.push(
        'item',
        sync(() => undefined),
      );
      queue.push(
        'item',
        sync(() => undefined),
      );

      expect(queue.status().waiting).toBe(1);
      expect(shed).toEqual([]);
      release();
      await queue.idle();
    });

    it('logs an onShed that fails or throws, and never throws itself', async () => {
      const queue = createIngestQueue({
        log,
        limit: 1,
        onShed: (key) => {
          if (key === 'a') throw new Error('counter down');
          return Promise.reject(new Error('still down'));
        },
      });
      const release = hold(queue);
      await Promise.resolve();
      expect(() => {
        for (const key of ['a', 'b', 'c'])
          queue.push(
            key,
            sync(() => undefined),
          );
      }).not.toThrow();
      await vi.waitFor(() => expect(logs).toHaveLength(4));

      const failures = logs.filter((l) => l.startsWith('counting the shed job'));
      expect(failures).toHaveLength(2);
      expect(failures[0]).toMatch(/^counting the shed job a failed: Error: counter down/);
      expect(failures[1]).toMatch(/^counting the shed job b failed: Error: still down/);
      release();
      await queue.idle();
    });

    it('holds a retry that comes back to the limit too', async () => {
      vi.useFakeTimers();
      const shed: string[] = [];
      const queue = createIngestQueue({
        log,
        limit: 1,
        retryDelayMs: 1_000,
        onShed: (key) => void shed.push(key),
      });
      let calls = 0;
      queue.push('limited', () => {
        calls++;
        return calls === 1 ? Promise.reject(rateLimitError()) : Promise.resolve();
      });
      await queue.idle();
      const release = hold(queue);
      await Promise.resolve();
      queue.push(
        'waiting',
        sync(() => undefined),
      );

      await vi.advanceTimersByTimeAsync(1_000);

      expect(shed).toEqual(['waiting']);
      release();
      await queue.idle();
      expect(calls).toBe(2);
    });
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
