import { describe, expect, it } from 'vitest';
import { FeedCard, relevanceBand } from './feed';

describe('relevanceBand', () => {
  it('is none at 0, medium above 0 and high from 0.8', () => {
    expect(relevanceBand(0)).toBe('none');
    expect(relevanceBand(0.001)).toBe('medium');
    expect(relevanceBand(0.448)).toBe('medium');
    expect(relevanceBand(0.79)).toBe('medium');
    expect(relevanceBand(0.8)).toBe('high');
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
      research: { state: 'none', runId: null },
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
