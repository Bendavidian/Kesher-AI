import { describe, expect, it } from 'vitest';
import { EventExplain, FeedCard, HIDDEN_RECENT, HiddenFeed, relevanceBand } from './feed';

describe('relevanceBand', () => {
  it('is none at 0, high only for a direct holding and medium for anything else', () => {
    expect(relevanceBand(0)).toBe('none');
    expect(relevanceBand(0.001)).toBe('medium');
    expect(relevanceBand(0.336)).toBe('medium');
    expect(relevanceBand(0.6)).toBe('medium');
    // A supply hop: medium since T16, high under the T05 placeholders.
    expect(relevanceBand(0.8)).toBe('medium');
    expect(relevanceBand(1)).toBe('high');
  });
});

describe('FeedCard', () => {
  const at = new Date('2026-09-28T12:00:00Z');
  const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
  const card = {
    item: {
      _id: id(1),
      userId: id(2),
      eventId: id(3),
      relevance: 1,
      path: { eventCompany: 'TSM', named: true, holding: 'TSM', hops: [] },
      confidence: 'medium',
      status: 'confirmed',
      research: { state: 'none', runId: null, reportId: null },
      createdAt: at,
      updatedAt: at,
    },
    event: {
      _id: id(3),
      sourceIds: [id(4)],
      headline: 'TSMC Suspends Chip Production',
      publishedAt: at,
      status: 'confirmed',
      extraction: null,
      createdAt: at,
    },
    source: {
      _id: id(4),
      provider: 'alpaca',
      kind: 'news',
      tier: 2,
      externalId: '38062166',
      url: 'https://www.benzinga.com/news/24/04/38062166',
      publisher: 'Benzinga',
      title: 'TSMC Suspends Chip Production',
      publishedAt: at,
      injectionScreen: null,
    },
    evidence: [],
    priceReaction: null,
  };

  it('accepts a card without the embedding or the source text', () => {
    expect(FeedCard.parse(card)).toEqual(card);
  });

  it('never carries the embedding, the untrusted body text or a price reaction yet', () => {
    expect(FeedCard.safeParse({ ...card, event: { ...card.event, embedding: null } }).success).toBe(
      false,
    );
    expect(FeedCard.safeParse({ ...card, source: { ...card.source, text: 'body' } }).success).toBe(
      false,
    );
    expect(FeedCard.safeParse({ ...card, priceReaction: {} }).success).toBe(false);
  });
});

describe('EventExplain', () => {
  const at = new Date('2026-09-28T12:00:00Z');
  const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
  const none = {
    event: {
      _id: id(3),
      sourceIds: [id(4)],
      headline: 'TSMC Suspends Chip Production',
      publishedAt: at,
      status: 'confirmed',
      extraction: null,
      createdAt: at,
    },
    source: {
      _id: id(4),
      provider: 'alpaca',
      kind: 'news',
      tier: 2,
      externalId: '38062166',
      url: 'https://www.benzinga.com/news/24/04/38062166',
      publisher: 'Benzinga',
      title: 'TSMC Suspends Chip Production',
      publishedAt: at,
      injectionScreen: null,
    },
    relevance: 0,
    path: null,
    confidence: 'medium',
    evidence: [],
  };

  it('accepts no path at relevance 0, and a path above 0', () => {
    expect(EventExplain.parse(none)).toEqual(none);
    const direct = {
      ...none,
      relevance: 1,
      path: { eventCompany: 'TSM', named: true, holding: 'TSM', hops: [] },
    };
    expect(EventExplain.parse(direct)).toEqual(direct);
  });

  it('rejects a path that disagrees with the relevance', () => {
    expect(EventExplain.safeParse({ ...none, relevance: 0.5 }).success).toBe(false);
    expect(
      EventExplain.safeParse({
        ...none,
        path: { eventCompany: 'TSM', named: true, holding: 'TSM', hops: [] },
      }).success,
    ).toBe(false);
  });

  it('carries no user, no FeedItem and no embedding', () => {
    expect(EventExplain.safeParse({ ...none, userId: id(2) }).success).toBe(false);
    expect(
      EventExplain.safeParse({ ...none, event: { ...none.event, embedding: null } }).success,
    ).toBe(false);
  });
});

describe('HiddenFeed', () => {
  const at = new Date('2026-09-28T12:00:00Z');
  const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
  const hidden = (n: number) => ({
    event: {
      _id: id(n),
      sourceIds: [id(9)],
      headline: 'Coca-Cola Q4 Adj. EPS Beats Estimate',
      publishedAt: at,
      status: 'confirmed',
      extraction: null,
      createdAt: at,
    },
    source: {
      _id: id(9),
      provider: 'alpaca',
      kind: 'news',
      tier: 2,
      externalId: '43618741',
      url: 'https://www.benzinga.com/news/25/02/43618741',
      publisher: 'Benzinga',
      title: 'Coca-Cola Q4 Adj. EPS Beats Estimate',
      publishedAt: at,
      injectionScreen: null,
    },
    relevance: 0,
    path: null,
    confidence: 'medium',
    evidence: [],
  });

  it('carries at most three recent items and the total they come from', () => {
    expect(HIDDEN_RECENT).toBe(3);
    const feed = { recent: [hidden(1), hidden(2), hidden(3)], total: 25 };
    expect(HiddenFeed.parse(feed)).toEqual(feed);
    expect(HiddenFeed.parse({ recent: [], total: 0 })).toEqual({ recent: [], total: 0 });
    expect(
      HiddenFeed.safeParse({ recent: [hidden(1), hidden(2), hidden(3), hidden(4)], total: 25 })
        .success,
    ).toBe(false);
  });

  it('rejects a total below the items it carries', () => {
    expect(HiddenFeed.safeParse({ recent: [hidden(1), hidden(2)], total: 1 }).success).toBe(false);
    expect(HiddenFeed.safeParse({ recent: [], total: -1 }).success).toBe(false);
  });

  it('carries only relevance 0 items', () => {
    const direct = {
      ...hidden(1),
      relevance: 1,
      path: { eventCompany: 'KO', named: true, holding: 'KO', hops: [] },
    };
    expect(HiddenFeed.safeParse({ recent: [direct], total: 1 }).success).toBe(false);
  });
});
