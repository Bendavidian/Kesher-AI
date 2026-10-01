import { describe, expect, it } from 'vitest';
import { FeedPath } from './domain/event';
import { joinList, whyYou } from './whyYou';

const relationshipId = '0b8c3f7e-2f4a-4a51-8d0e-2a4f5c6d7e81';

describe('whyYou', () => {
  it('renders a supplier path hop by hop, ending at the holding', () => {
    const path = FeedPath.parse({
      eventCompany: 'TSM',
      holding: 'NVDA',
      hops: [{ from: 'TSM', to: 'NVDA', type: 'supplier_of', weight: 0.8, relationshipId }],
    });
    expect(whyYou(path, 'TSM', ['NVDA', 'MSFT', 'AMZN'])).toEqual({
      connected: true,
      label: 'TSMC supplies NVIDIA, and NVIDIA is in your portfolio',
      rowLabel: 'TSMC supplies NVIDIA, which you hold',
      mention: null,
      explanation: null,
    });
  });

  it('uses the verb of each edge type, in both directions', () => {
    const path = FeedPath.parse({
      eventCompany: 'NVDA',
      holding: 'AMD',
      hops: [
        { from: 'NVDA', to: 'TSM', type: 'customer_of', weight: 0.8, relationshipId },
        { from: 'TSM', to: 'AMD', type: 'supplier_of', weight: 0.8, relationshipId },
      ],
    });
    expect(whyYou(path, 'NVDA', ['AMD']).label).toBe(
      'NVIDIA buys from TSMC, TSMC supplies AMD, and AMD is in your portfolio',
    );
    const competitor = FeedPath.parse({
      eventCompany: 'AMD',
      holding: 'NVDA',
      hops: [{ from: 'AMD', to: 'NVDA', type: 'competitor_of', weight: 0.6, relationshipId }],
    });
    expect(whyYou(competitor, 'AMD', ['NVDA']).rowLabel).toBe(
      'AMD competes with NVIDIA, which you hold',
    );
  });

  it('names a direct holding', () => {
    const path = FeedPath.parse({ eventCompany: 'TSM', holding: 'TSM', hops: [] });
    expect(whyYou(path, 'TSM', ['AMD', 'TSM'])).toEqual({
      connected: true,
      label: 'You hold TSMC directly',
      rowLabel: 'You hold TSMC',
      mention: null,
      explanation: null,
    });
  });

  it('says when the item only mentions a holding in passing', () => {
    const path = FeedPath.parse({ eventCompany: 'NVDA', named: false, holding: 'NVDA', hops: [] });
    expect(whyYou(path, 'NVDA', ['NVDA', 'MSFT', 'AMZN'])).toEqual({
      connected: true,
      label: 'You hold NVIDIA, which the item mentions only in passing',
      rowLabel: 'You hold NVIDIA, mentioned in passing',
      mention: 'The item mentions NVIDIA only in passing.',
      explanation: null,
    });
  });

  it('says when a path starts from a company the item only mentions in passing', () => {
    const path = FeedPath.parse({
      eventCompany: 'TSM',
      named: false,
      holding: 'NVDA',
      hops: [{ from: 'TSM', to: 'NVDA', type: 'supplier_of', weight: 0.8, relationshipId }],
    });
    expect(whyYou(path, 'TSM', ['NVDA', 'MSFT', 'AMZN'])).toEqual({
      connected: true,
      label:
        'The item mentions TSMC only in passing; TSMC supplies NVIDIA, and NVIDIA is in your portfolio',
      rowLabel: 'Mentioned in passing: TSMC supplies NVIDIA, which you hold',
      mention: 'The item mentions TSMC only in passing.',
      explanation: null,
    });
  });

  it('reads a path stored before T27, which has no named flag, as named', () => {
    // A raw read from the database, without the schema's default.
    const stored = { eventCompany: 'TSM', holding: 'TSM', hops: [] } as unknown as FeedPath;
    expect(whyYou(stored, 'TSM', ['TSM'])).toMatchObject({
      label: 'You hold TSMC directly',
      mention: null,
    });
  });

  it('explains a missing path with the holdings it checked', () => {
    expect(whyYou(null, 'TSM', ['KO', 'JNJ', 'XOM'])).toEqual({
      connected: false,
      label: 'No connection from TSMC to your holdings',
      rowLabel: 'No path to your holdings',
      mention: null,
      explanation:
        'You hold KO, JNJ and XOM. Nothing in the graph links them to TSMC within two stops.',
    });
  });
});

describe('joinList', () => {
  it('joins with commas and a final conjunction', () => {
    expect(joinList([])).toBe('');
    expect(joinList(['NVDA'])).toBe('NVDA');
    expect(joinList(['KO', 'JNJ'])).toBe('KO and JNJ');
    expect(joinList(['AMD', 'AVGO', 'TSM', 'ASML'])).toBe('AMD, AVGO, TSM and ASML');
    expect(joinList(['KO', 'JNJ', 'XOM'], 'or')).toBe('KO, JNJ or XOM');
  });
});
