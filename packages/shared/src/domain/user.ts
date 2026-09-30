import { z } from 'zod';
import { Id, Theme } from './common';
import { UniverseSymbol } from './universe';

export const Holding = z.strictObject({
  symbol: UniverseSymbol,
  quantity: z.number().positive(),
});
export type Holding = z.infer<typeof Holding>;

// passwordHash never leaves the api; the web gets a public user shape (T06).
export const User = z.strictObject({
  _id: Id,
  email: z.email().lowercase(),
  passwordHash: z.string().min(1),
  displayName: z.string().min(1),
  holdings: z
    .array(Holding)
    .refine((holdings) => new Set(holdings.map((h) => h.symbol)).size === holdings.length, {
      error: 'each symbol appears once',
    }),
  interests: z.array(Theme),
  createdAt: z.date(),
  // Only a guest has it: the TTL index removes the guest at this time (SPEC.md decision log,
  // T24). The seeded personas never expire.
  expiresAt: z.date().optional(),
  // A guest's last Investigate, as its UTC day: one run per guest per day (T24).
  investigatedOn: z.iso.date().optional(),
});
export type User = z.infer<typeof User>;

export const isGuest = (user: Pick<User, 'expiresAt'>): boolean => user.expiresAt !== undefined;
