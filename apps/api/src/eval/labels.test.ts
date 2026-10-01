import { describe, expect, it } from 'vitest';
import { loadEvents, type EvalEvent } from './dataset';
import {
  checkLabels,
  loadLabels,
  parseLevel,
  pendingItems,
  recordReview,
  type Label,
} from './labels';

const now = new Date('2026-09-29T12:00:00.000Z');

const event = (id: string): EvalEvent => ({
  id,
  symbol: 'TSM',
  createdAt: '2024-04-03T03:57:09Z',
  updatedAt: '2024-04-03T04:01:37Z',
  type: 'production_disruption',
});

const proposed = (sourceId: string, persona: 'A' | 'B' | 'C'): Label => ({
  sourceId,
  persona,
  level: 'none',
  status: 'proposed',
  reason: 'no path',
});

const three = (sourceId: string) => (['A', 'B', 'C'] as const).map((p) => proposed(sourceId, p));

describe('the committed eval set', () => {
  it('has 30 items and 4 market wraps, with exactly one label per persona', async () => {
    const events = await loadEvents();
    expect(events.filter((e) => e.type !== 'market_wrap')).toHaveLength(30);
    expect(events.filter((e) => e.type === 'market_wrap')).toHaveLength(4);
    expect(checkLabels(events, await loadLabels())).toEqual([]);
  });
});

describe('checkLabels', () => {
  it('names missing, duplicate and unknown labels', () => {
    const labels = [...three('1'), proposed('1', 'A'), proposed('9', 'B')].filter(
      (l, i) => i !== 2,
    );
    expect(checkLabels([event('1')], labels)).toEqual([
      '1/A: labeled twice',
      '9/B: not an eval item',
      '1/C: no label',
    ]);
  });
});

describe('pendingItems', () => {
  const events = [event('1'), event('2')];

  it('lists items with any persona not reviewed, and only the redo item on redo', () => {
    let labels = [...three('1'), ...three('2')];
    expect(pendingItems(events, labels).map((e) => e.id)).toEqual(['1', '2']);
    labels = recordReview(labels, '1', { A: 'high', B: 'medium', C: 'none' }, now);
    expect(pendingItems(events, labels).map((e) => e.id)).toEqual(['2']);
    expect(pendingItems(events, labels, '1').map((e) => e.id)).toEqual(['1']);
  });
});

describe('recordReview', () => {
  it('replaces the three labels in place and keeps the proposed level', () => {
    const labels = recordReview(
      [...three('1'), ...three('2')],
      '1',
      {
        A: 'high',
        B: 'medium',
        C: 'none',
      },
      now,
    );
    expect(labels.slice(0, 3)).toEqual([
      {
        sourceId: '1',
        persona: 'A',
        level: 'high',
        status: 'reviewed',
        proposed: 'none',
        decidedAt: now.toISOString(),
      },
      {
        sourceId: '1',
        persona: 'B',
        level: 'medium',
        status: 'reviewed',
        proposed: 'none',
        decidedAt: now.toISOString(),
      },
      {
        sourceId: '1',
        persona: 'C',
        level: 'none',
        status: 'reviewed',
        proposed: 'none',
        decidedAt: now.toISOString(),
      },
    ]);
    expect(labels.slice(3)).toEqual(three('2'));
  });

  it('keeps the first proposal when an item is reviewed again', () => {
    const once = recordReview(three('1'), '1', { A: 'high', B: 'high', C: 'high' }, now);
    const twice = recordReview(once, '1', { A: 'medium', B: 'none', C: 'none' }, now);
    expect(twice.map((l) => (l.status === 'reviewed' ? l.proposed : null))).toEqual([
      'none',
      'none',
      'none',
    ]);
  });
});

describe('parseLevel', () => {
  it.each([
    ['h', { kind: 'level', level: 'high' }],
    [' Medium ', { kind: 'level', level: 'medium' }],
    ['n', { kind: 'level', level: 'none' }],
    ['s', { kind: 'skip' }],
    ['q', { kind: 'quit' }],
    ['x', null],
    ['', null],
  ])('%j', (input, expected) => {
    expect(parseLevel(input)).toEqual(expected);
  });
});
