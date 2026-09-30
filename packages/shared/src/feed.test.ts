import { describe, expect, it } from 'vitest';
import { EventExplain, FeedCard, relevanceBand } from './feed';

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
      path: { eventCompany: 'TSM', holding: 'TSM', hops: [] },
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
      path: { eventCompany: 'TSM', holding: 'TSM', hops: [] },
    };
    expect(EventExplain.parse(direct)).toEqual(direct);
  });

  it('rejects a path that disagrees with the relevance', () => {
    expect(EventExplain.safeParse({ ...none, relevance: 0.5 }).success).toBe(false);
    expect(
      EventExplain.safeParse({
        ...none,
        path: { eventCompany: 'TSM', holding: 'TSM', hops: [] },
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
