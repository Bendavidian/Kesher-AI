import { Company, FeedItem, MarketEvent, Relationship } from '@kesher/shared';
import { describe, expect, it } from 'vitest';
import {
  COMPANIES,
  DEMO_EVENT,
  DEMO_NEWS_SOURCE,
  DEMO_PRICE_REACTION,
  FEED_ITEMS,
  RELATIONSHIPS,
} from './demoEvent';
import { PERSONAS } from './personas';

describe('fixtures', () => {
  it('pass the shared schemas unchanged', () => {
    expect(MarketEvent.parse(DEMO_EVENT)).toEqual(DEMO_EVENT);
    for (const company of COMPANIES) expect(Company.parse(company)).toEqual(company);
    for (const edge of RELATIONSHIPS) expect(Relationship.parse(edge)).toEqual(edge);
    for (const persona of PERSONAS) {
      for (const item of FEED_ITEMS[persona.key]) expect(FeedItem.parse(item)).toEqual(item);
    }
  });

  it('pin the real demo item from the spike', () => {
    expect(DEMO_NEWS_SOURCE.externalId).toBe('38062166');
    expect(DEMO_NEWS_SOURCE.tier).toBe(2);
    expect(DEMO_EVENT.sourceIds).toEqual([DEMO_NEWS_SOURCE._id]);
    expect(DEMO_EVENT.headline).toBe(
      'TSMC Suspends Chip Production After Taiwan Rocked By Strongest Tremor In 25 Years',
    );
    expect(DEMO_EVENT.publishedAt.toISOString()).toBe('2024-04-03T03:57:09.000Z');
  });

  it('keep the anchored price moves from docs/SPIKE.md', () => {
    const bySymbol = Object.fromEntries(DEMO_PRICE_REACTION.rows.map((row) => [row.symbol, row]));
    expect(bySymbol.TSM?.moves).toEqual([-1.16, -0.38, 1.31, 1.25]);
    expect(bySymbol.NVDA?.moves).toEqual([-1.07, -0.9, 0.86, -0.54]);
    expect(bySymbol.SMH?.moves).toEqual([-1.0, -0.68, 0.96, 0.4]);
    expect(bySymbol.SPY?.moves).toEqual([-0.22, -0.07, 0.4, 0.1]);
  });

  it('give every path hop a reviewed relationship with a quote', () => {
    const edges = new Map(RELATIONSHIPS.map((edge) => [edge._id, edge]));
    for (const persona of PERSONAS) {
      for (const item of FEED_ITEMS[persona.key]) {
        for (const hop of item.path?.hops ?? []) {
          const edge = edges.get(hop.relationshipId);
          expect(edge).toMatchObject({ from: hop.from, to: hop.to, type: hop.type });
          expect(edge?.evidence.reviewed).toBe(true);
        }
      }
    }
  });

  it('end every path at a holding of that persona', () => {
    for (const persona of PERSONAS) {
      const held = persona.holdings.map((holding) => holding.symbol);
      for (const item of FEED_ITEMS[persona.key]) {
        if (item.path) expect(held).toContain(item.path.holding);
        expect(item.userId).toBe(persona._id);
      }
    }
  });
});
