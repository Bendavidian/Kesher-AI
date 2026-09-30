import { z } from 'zod';
import { UniverseSymbol } from './domain/universe';

// Guest portfolios on the public instance (SPEC.md decision log, T24): a visitor picks holdings
// from the universe and gets a temporary user that expires after GUEST_TTL_MS.

export const GUEST_TTL_MS = 24 * 60 * 60 * 1000;
export const MAX_GUEST_HOLDINGS = 6;

// POST /guest and PUT /guest/portfolio (docs/INTERFACES.md, REST). Symbols only: strict, so a
// user id or a quantity is rejected, and a benchmark is not a universe company.
export const GuestPortfolioRequest = z.strictObject({
  symbols: z
    .array(UniverseSymbol)
    .min(1)
    .max(MAX_GUEST_HOLDINGS)
    .refine((symbols) => new Set(symbols).size === symbols.length, {
      error: 'each symbol appears once',
    }),
});
export type GuestPortfolioRequest = z.infer<typeof GuestPortfolioRequest>;
