import { describeError } from '../config/redact';
import { ExtractionFailedError } from '../extract/extraction';
import { isRateLimited, MissingModelKeyError, requestedWaitMs } from '../llm/client';

// The in process job queue for live items (SPEC.md Stack). One job runs at a time, so the model
// limiter is never raced and two versions of one item never run side by side (BACKLOG.md T10,
// note from T04). A job waiting under a key that is pushed again runs the newer version once.
// At most limit jobs wait: a burst past it sheds the oldest waiting job (SPEC.md decision log,
// T19), a job pushed with shedLast only when no other job waits.

export interface IngestQueue {
  // shedLast: for filings, which the poller hands over once per process, so a shed one would not
  // come back before a restart.
  push(key: string, job: () => Promise<unknown>, options?: { shedLast?: boolean }): void;
  // Resolves once nothing runs and nothing waits. A job waiting for its retry does not count.
  idle(): Promise<void>;
  status(): { waiting: number; running: boolean; limit: number };
  // Takes no more jobs, drops the waiting ones and resolves when the running one ends.
  stop(): Promise<void>;
}

export interface QueueOptions {
  log?: (message: string) => void;
  // A rate limited job is pushed again after the provider's wait, at least this long.
  retryDelayMs?: number;
  maxRetries?: number;
  limit?: number;
  // Told the key of each shed job, to count it. Its failure is logged and never thrown.
  onShed?: (key: string) => Promise<void> | void;
}

// Longer than any per minute window; a daily quota ends the retries instead.
const MAX_RETRY_DELAY_MS = 15 * 60_000;

// About six minutes of extractions at Groq's 8,000 tokens a minute, far more than a normal hour
// of universe news, so only a burst (a gap fill after a long outage, a first start) reaches it.
export const QUEUE_LIMIT = 50;

interface Entry {
  key: string;
  job: () => Promise<unknown>;
  attempt: number;
  shedLast: boolean;
}

export function createIngestQueue({
  log = console.log,
  retryDelayMs = 60_000,
  maxRetries = 3,
  limit: requestedLimit = QUEUE_LIMIT,
  onShed,
}: QueueOptions = {}): IngestQueue {
  const limit = Math.max(1, requestedLimit);
  const waiting: Entry[] = [];
  const timers = new Set<NodeJS.Timeout>();
  let running: Promise<void> | null = null;
  let stopped = false;
  let idleWaiters: (() => void)[] = [];

  const enqueue = (entry: Entry) => {
    if (stopped) return;
    const same = waiting.find((w) => w.key === entry.key);
    if (same) {
      same.job = entry.job;
      same.attempt = Math.max(same.attempt, entry.attempt);
    } else {
      if (waiting.length >= limit) shedOne();
      waiting.push(entry);
    }
    if (!running) running = drain();
  };

  // The oldest waiting job, unless it is to be shed last and another one is not.
  const shedOne = () => {
    const index = Math.max(
      0,
      waiting.findIndex((w) => !w.shedLast),
    );
    const [{ key }] = waiting.splice(index, 1) as [Entry];
    log(`live queue full (${limit} waiting); dropped ${key}`);
    void (async () => onShed?.(key))().catch((error: unknown) =>
      log(`counting the shed job ${key} failed: ${describeError(error)}`),
    );
  };

  const retry = (entry: Entry, error: unknown) => {
    const next = entry.attempt + 1;
    if (next > maxRetries) {
      log(`live ${entry.key} still rate limited after ${maxRetries} retries; replay it later`);
      return;
    }
    const asked = isRateLimited(error) ? requestedWaitMs(error) : undefined;
    const wait = Math.min(Math.max(asked ?? 0, retryDelayMs), MAX_RETRY_DELAY_MS);
    log(
      `live ${entry.key} rate limited; retry ${next} of ${maxRetries} in ${Math.round(wait / 1000)} s`,
    );
    const timer = setTimeout(() => {
      timers.delete(timer);
      enqueue({ ...entry, attempt: next });
    }, wait);
    timer.unref();
    timers.add(timer);
  };

  async function drain(): Promise<void> {
    for (let entry = waiting.shift(); entry; entry = waiting.shift()) {
      try {
        await entry.job();
      } catch (error) {
        if (isRateLimited(error)) retry(entry, error);
        // The item stays stored without an extraction and resumes on replay or when it comes again.
        else if (error instanceof MissingModelKeyError) log(`live ${entry.key}: ${error.message}`);
        else if (error instanceof ExtractionFailedError) {
          // processItem has counted and logged it already.
        } else log(`live ${entry.key} failed: ${describeError(error)}`);
      }
      if (stopped) break;
    }
    running = null;
    const waiters = idleWaiters;
    idleWaiters = [];
    for (const resolve of waiters) resolve();
  }

  return {
    push: (key, job, { shedLast = false } = {}) => enqueue({ key, job, attempt: 0, shedLast }),
    status: () => ({ waiting: waiting.length, running: running !== null, limit }),
    idle: () =>
      running ? new Promise<void>((resolve) => idleWaiters.push(resolve)) : Promise.resolve(),
    async stop() {
      stopped = true;
      waiting.length = 0;
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      await running;
    },
  };
}
