import { describe, expect, it } from 'vitest';
import { UNIVERSE, UNIVERSE_SECTORS } from './domain/universe';
import { isGuest } from './domain/user';
import { GuestPortfolioRequest, MAX_GUEST_HOLDINGS } from './guest';

describe('GuestPortfolioRequest', () => {
  it('accepts 1 to 6 distinct universe companies', () => {
    expect(GuestPortfolioRequest.parse({ symbols: ['NVDA'] })).toEqual({ symbols: ['NVDA'] });
    const six = ['NVDA', 'MSFT', 'TSM', 'ASML', 'KO', 'XOM'];
    expect(six).toHaveLength(MAX_GUEST_HOLDINGS);
    expect(GuestPortfolioRequest.safeParse({ symbols: six }).success).toBe(true);
  });

  it('rejects none, seven, a repeat, a benchmark and an unknown ticker', () => {
    for (const symbols of [
      [],
      ['NVDA', 'MSFT', 'TSM', 'ASML', 'KO', 'XOM', 'JNJ'],
      ['NVDA', 'NVDA'],
      ['SPY'],
      ['AAPL'],
    ]) {
      expect(GuestPortfolioRequest.safeParse({ symbols }).success, symbols.join(',')).toBe(false);
    }
  });

  it('rejects a user id or quantities', () => {
    expect(
      GuestPortfolioRequest.safeParse({
        symbols: ['NVDA'],
        userId: '00000000-0000-4000-8000-000000000001',
      }).success,
    ).toBe(false);
    expect(
      GuestPortfolioRequest.safeParse({ symbols: [{ symbol: 'NVDA', quantity: 5 }] }).success,
    ).toBe(false);
  });
});

describe('UNIVERSE_SECTORS', () => {
  it('lists every universe company once, in universe order', () => {
    expect(UNIVERSE_SECTORS.flatMap((sector) => sector.symbols)).toEqual([...UNIVERSE]);
  });
});

describe('isGuest', () => {
  it('is true only with an expiry', () => {
    expect(isGuest({ expiresAt: new Date() })).toBe(true);
    expect(isGuest({})).toBe(false);
  });
});
