import { describe, expect, it } from 'vitest';
import type { EventExplain, FeedCard } from '@kesher/shared';
import { DEMO_CARDS, DEMO_EXPLAINS, PERSONAS } from '../fixtures';
import { DEMO_EVENT } from '../fixtures/demoEvent';
import { buildFeedView } from './feed';

const [A, , C] = PERSONAS;
const NONE_HIDDEN = { recent: [], total: 0 };

describe('buildFeedView', () => {
  it('shows cards above 0 and selects the replayed one', () => {
    const view = buildFeedView(
      A!,
      { cards: DEMO_CARDS.A, hidden: NONE_HIDDEN, replayedEventId: DEMO_EVENT._id },
      null,
    );
    expect(view.visible.map((entry) => entry.score.relevance)).toEqual([0.8]);
    expect(view.hidden).toEqual([]);
    expect(view.selected?.replayed).toBe(true);
    expect(view.selected?.source.wire).toBe('Benzinga');
    expect(view.selected?.evidence[0]?.filingLabel).toBe('NVIDIA 10-K, filed Feb 25, 2026');
  });

  it('lists an explained event at 0 as hidden', () => {
    const view = buildFeedView(
      C!,
      { cards: [], hidden: { recent: [DEMO_EXPLAINS.C], total: 1 }, replayedEventId: null },
      null,
    );
    expect(view.visible).toEqual([]);
    expect(view.hidden.map((entry) => entry.key)).toEqual([DEMO_EVENT._id]);
    expect(view.selected?.relevanceNote).toBe('None. No path to your holdings.');
  });

  it('never shows an event twice: a card wins over an explanation', () => {
    const view = buildFeedView(
      A!,
      {
        cards: DEMO_CARDS.A,
        hidden: { recent: [DEMO_EXPLAINS.C], total: 1 },
        replayedEventId: null,
      },
      null,
    );
    expect([...view.visible, ...view.hidden]).toHaveLength(1);
    expect(view.visible[0]?.key).toBe(DEMO_CARDS.A[0]!.item._id);
  });

  it('has nothing to select in an empty feed', () => {
    expect(
      buildFeedView(C!, { cards: [], hidden: NONE_HIDDEN, replayedEventId: null }, null),
    ).toEqual({ visible: [], hidden: [], hiddenTotal: 0, selected: null });
  });

  it('orders cards by arrival, so an older event replayed now lands on top', () => {
    const demo = DEMO_CARDS.A[0]!;
    // A later event that arrived an hour before the demo card was replayed.
    const later: FeedCard = {
      ...demo,
      item: {
        ...demo.item,
        _id: '00000000-0000-4000-8000-0000000000b1',
        eventId: '00000000-0000-4000-8000-0000000000b2',
        createdAt: new Date(demo.item.createdAt.getTime() - 3_600_000),
      },
      event: {
        ...demo.event,
        _id: '00000000-0000-4000-8000-0000000000b2',
        headline: 'A later event that arrived earlier',
        publishedAt: new Date(demo.event.publishedAt.getTime() + 365 * 86_400_000),
      },
    };
    const view = buildFeedView(
      A!,
      { cards: [later, demo], hidden: NONE_HIDDEN, replayedEventId: null },
      null,
    );
    expect(view.visible.map((entry) => entry.key)).toEqual([demo.item._id, later.item._id]);
    // With nothing chosen, the newest arrival is selected.
    expect(view.selected?.key).toBe(demo.item._id);
  });

  it('keeps the hidden items in the order they came and carries their total', () => {
    const hiddenItem = (n: number): EventExplain => ({
      ...DEMO_EXPLAINS.C,
      event: { ...DEMO_EXPLAINS.C.event, _id: `00000000-0000-4000-8000-0000000000c${n}` },
    });
    const recent = [hiddenItem(3), hiddenItem(1), hiddenItem(2)];
    const view = buildFeedView(
      C!,
      { cards: [], hidden: { recent, total: 25 }, replayedEventId: null },
      null,
    );
    expect(view.hidden.map((entry) => entry.key)).toEqual(recent.map((e) => e.event._id));
    expect(view.hiddenTotal).toBe(25);
    expect(view.selected?.key).toBe(recent[0]!.event._id);
  });
});
