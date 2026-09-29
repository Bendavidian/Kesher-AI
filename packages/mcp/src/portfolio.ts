import { UniverseSymbol } from '@kesher/shared';
import { z } from 'zod';
import type { ToolDefinition } from './tools';

// get_my_portfolio: the holdings of the token's user. There is no argument at all, so no call can
// name another user (principle 5).

const GetMyPortfolioInput = z.strictObject({});

const GetMyPortfolioOutput = z.strictObject({
  holdings: z.array(z.strictObject({ symbol: UniverseSymbol, quantity: z.number().positive() })),
});
type GetMyPortfolioOutput = z.output<typeof GetMyPortfolioOutput>;

export const getMyPortfolio: ToolDefinition<
  typeof GetMyPortfolioInput,
  typeof GetMyPortfolioOutput
> = {
  name: 'get_my_portfolio',
  description:
    'The holdings of the investor this run serves: symbols and share quantities, sorted by symbol.',
  inputSchema: GetMyPortfolioInput,
  outputSchema: GetMyPortfolioOutput,
  async run(_input, { users }, { claims }) {
    // Only the holdings; the email, name and password hash never leave the database.
    const user = await users.findOne({ _id: claims.sub }, { projection: { holdings: 1 } });
    if (!user) return { ok: false, error: 'No portfolio for this run' };
    const holdings = [...user.holdings]
      .sort((a, b) => a.symbol.localeCompare(b.symbol))
      .map(({ symbol, quantity }) => ({ symbol, quantity }));
    return { ok: true, output: { holdings } };
  },
};
