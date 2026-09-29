// The in process job queue (SPEC.md Stack): first in, first out, one job at a time. Research runs
// go through it, so automatic runs for several users never compete for the provider's per minute
// limits. Jobs live in memory only; a job lost to a restart is left to the stale takeover of its
// FeedItem (apps/api/src/research/enqueue.ts).

export type Job = () => Promise<void>;

export interface JobQueue {
  // Resolves once this job has run. A job that throws is logged and never stops the queue.
  push(job: Job): Promise<void>;
}

export function createQueue({
  logError = () => undefined,
}: { logError?: (error: unknown) => void } = {}): JobQueue {
  let tail: Promise<void> = Promise.resolve();
  return {
    push(job) {
      const run = tail.then(job).catch((error: unknown) => {
        logError(error);
      });
      tail = run;
      return run;
    },
  };
}
