import { describe, expect, it } from 'vitest';
import { createQueue } from './queue';

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

describe('createQueue', () => {
  it('runs jobs one at a time, in the order they were pushed', async () => {
    const errors: unknown[] = [];
    const queue = createQueue({ logError: (error) => errors.push(error) });
    const log: string[] = [];
    let active = 0;
    const job = (name: string) => async () => {
      active += 1;
      expect(active).toBe(1);
      log.push(`start ${name}`);
      await tick();
      log.push(`end ${name}`);
      active -= 1;
    };
    await Promise.all([queue.push(job('a')), queue.push(job('b')), queue.push(job('c'))]);
    expect(log).toEqual(['start a', 'end a', 'start b', 'end b', 'start c', 'end c']);
    expect(errors).toEqual([]);
  });

  it('logs a job that fails and goes on with the next', async () => {
    const errors: unknown[] = [];
    const queue = createQueue({ logError: (error) => errors.push(error) });
    const ran: string[] = [];
    const failed = queue.push(async () => {
      await tick();
      throw new Error('the job broke');
    });
    const next = queue.push(() => {
      ran.push('next');
      return Promise.resolve();
    });
    await expect(failed).resolves.toBeUndefined();
    await next;
    expect(ran).toEqual(['next']);
    expect(errors).toEqual([new Error('the job broke')]);
  });

  it('resolves push when its own job is done', async () => {
    const queue = createQueue();
    let done = false;
    await queue.push(async () => {
      await tick();
      done = true;
    });
    expect(done).toBe(true);
  });
});
