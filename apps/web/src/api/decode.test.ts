import { describe, expect, it } from 'vitest';
import { DEMO_CARDS, DEMO_EXPLAINS } from '../fixtures';
import { decodeExplain, decodeFeed, decodeFeedCard, reviveDates } from './decode';

// What JSON.stringify makes of a card on the wire: every Date becomes an ISO string.
const overTheWire = (value: unknown) => JSON.parse(JSON.stringify(value)) as unknown;

describe('decoding api responses', () => {
  it('turns ISO date times back into Dates before parsing a FeedCard', () => {
    const card = DEMO_CARDS.A[0]!;
    expect(decodeFeedCard(overTheWire(card))).toEqual(card);
    expect(decodeFeed(overTheWire(DEMO_CARDS.A))).toEqual(DEMO_CARDS.A);
  });

  it('decodes an explanation', () => {
    expect(decodeExplain(overTheWire(DEMO_EXPLAINS.C))).toEqual(DEMO_EXPLAINS.C);
  });

  it('leaves plain dates, such as a filing date, as strings', () => {
    expect(reviveDates({ filingDate: '2026-02-25', at: '2026-02-25T21:42:19.000Z' })).toEqual({
      filingDate: '2026-02-25',
      at: new Date('2026-02-25T21:42:19.000Z'),
    });
  });

  it('rejects what is not a FeedCard, such as one that carries the source text', () => {
    const card = overTheWire(DEMO_CARDS.A[0]) as { source: object };
    expect(() => decodeFeedCard({ ...card, source: { ...card.source, text: 'body' } })).toThrow();
    expect(() => decodeFeed({ cards: [] })).toThrow();
  });
});
