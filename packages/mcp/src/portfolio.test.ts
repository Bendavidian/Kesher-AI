import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { getMyPortfolio } from './portfolio';
import type { RunTokenClaims } from './token';
import type { ToolDeps } from './tools';

describe('get_my_portfolio', () => {
  const userId = randomUUID();
  const claims = { sub: userId } as RunTokenClaims;

  function depsWith(found: object | null) {
    const calls: unknown[][] = [];
    const users = {
      findOne: (...args: unknown[]) => {
        calls.push(args);
        return Promise.resolve(found);
      },
    };
    return { deps: { users } as unknown as ToolDeps, calls };
  }

  it("reads the token user's holdings only, sorted by symbol", async () => {
    const { deps, calls } = depsWith({
      holdings: [
        { symbol: 'TSM', quantity: 5 },
        { symbol: 'NVDA', quantity: 10 },
      ],
    });
    const outcome = await getMyPortfolio.run({}, deps, { claims });
    expect(outcome).toEqual({
      ok: true,
      output: {
        holdings: [
          { symbol: 'NVDA', quantity: 10 },
          { symbol: 'TSM', quantity: 5 },
        ],
      },
    });
    expect(calls).toEqual([[{ _id: userId }, { projection: { holdings: 1 } }]]);
  });

  it('answers a tool error when the user is gone', async () => {
    const { deps } = depsWith(null);
    expect(await getMyPortfolio.run({}, deps, { claims })).toEqual({
      ok: false,
      error: 'No portfolio for this run',
    });
  });

  it('takes no argument, so a user id is rejected', () => {
    expect(getMyPortfolio.inputSchema.safeParse({}).success).toBe(true);
    expect(getMyPortfolio.inputSchema.safeParse({ userId }).success).toBe(false);
  });
});
