import { describe, expect, it } from 'vitest';
import { DEMO_CARDS, DEMO_EXPLAINS, PERSONAS } from '../fixtures';
import { DEMO_EVENT } from '../fixtures/demoEvent';
import { buildFeedView } from './feed';

const [A, , C] = PERSONAS;

describe('buildFeedView', () => {
  it('shows cards above 0 and selects the replayed one', () => {
    const view = buildFeedView(
      A!,
      { cards: DEMO_CARDS.A, explains: [], replayedEventId: DEMO_EVENT._id },
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
      { cards: [], explains: [DEMO_EXPLAINS.C], replayedEventId: null },
      null,
    );
    expect(view.visible).toEqual([]);
    expect(view.hidden.map((entry) => entry.key)).toEqual([DEMO_EVENT._id]);
    expect(view.selected?.relevanceNote).toBe('None. No path to your holdings.');
  });

  it('never shows an event twice: a card wins over an explanation', () => {
    const view = buildFeedView(
      A!,
      { cards: DEMO_CARDS.A, explains: [DEMO_EXPLAINS.C], replayedEventId: null },
      null,
    );
    expect([...view.visible, ...view.hidden]).toHaveLength(1);
    expect(view.visible[0]?.key).toBe(DEMO_CARDS.A[0]!.item._id);
  });

  it('has nothing to select in an empty feed', () => {
    expect(buildFeedView(C!, { cards: [], explains: [], replayedEventId: null }, null)).toEqual({
      visible: [],
      hidden: [],
      selected: null,
    });
  });
});
