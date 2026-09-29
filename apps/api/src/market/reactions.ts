import {
  type MarketData,
  type PriceReaction,
  type PriceSymbol,
  priceReactionFor,
} from '@kesher/shared';

// The price reaction as the api serves it, to the MCP tool and to FeedCard.priceReaction. A
// complete result can no longer change, so it is kept in process; an incomplete one is computed
// again on the next call. No collection stores reactions in the MVP (SPEC.md decision log, T13).

export type PriceReactions = (
  subjects: readonly PriceSymbol[],
  headline: Date,
) => Promise<PriceReaction>;

export const MAX_CACHED_REACTIONS = 1_000;

export function createPriceReactions(
  market: MarketData,
  { now = () => new Date(), limit = MAX_CACHED_REACTIONS } = {},
): PriceReactions {
  const complete = new Map<string, PriceReaction>();
  const cap = Math.max(1, limit);
  return async (subjects, headline) => {
    const key = `${[...subjects].join(',')} ${headline.toISOString()}`;
    const cached = complete.get(key);
    if (cached) return cached;
    const reaction = await priceReactionFor(market, subjects, headline, now());
    if (reaction.complete) {
      // Oldest first: a Map keeps insertion order.
      if (complete.size >= cap) complete.delete(complete.keys().next().value!);
      complete.set(key, reaction);
    }
    return reaction;
  };
}
