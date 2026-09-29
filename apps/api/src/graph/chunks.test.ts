import { describe, expect, it } from 'vitest';
import { chunkSections, chunkSentences, isHeading, runs } from './chunks';

// A stand-in for the tokenizer: one token per word plus [CLS] and [SEP].
const words = (text: string) => (text === '' ? 0 : text.split(' ').length) + 2;
const limits = { maxTokens: 10, maxChars: 2_000 };

describe('chunkSentences', () => {
  it('packs whole sentences in order while they fit', () => {
    const list = ['One two three.', 'Four five six.', 'Seven eight nine ten.'];
    expect(chunkSentences(list, words, limits)).toEqual([
      'One two three. Four five six.',
      'Seven eight nine ten.',
    ]);
  });

  it('keeps every chunk within the token limit, the special tokens included', () => {
    const list = Array.from({ length: 40 }, (_, i) => `Sentence ${i} has five words.`);
    const chunks = chunkSentences(list, words, limits);
    for (const chunk of chunks) expect(words(chunk)).toBeLessThanOrEqual(10);
  });

  it('splits a sentence longer than a chunk on word boundaries, losing no text', () => {
    const long = Array.from({ length: 25 }, (_, i) => `w${i}`).join(' ');
    const list = ['Short one.', long, 'After.'];
    const chunks = chunkSentences(list, words, limits);
    expect(chunks.every((c) => words(c) <= 10)).toBe(true);
    expect(chunks.join(' ')).toBe(list.join(' '));
    expect(chunks[0]).toBe('Short one.');
  });

  it('keeps every chunk within the character limit', () => {
    const list = ['a'.repeat(30), 'b'.repeat(30), 'c'.repeat(30)];
    const chunks = chunkSentences(list, words, { maxTokens: 100, maxChars: 40 });
    expect(chunks).toEqual(['a'.repeat(30), 'b'.repeat(30), 'c'.repeat(30)]);
    expect(chunkSentences(['x'.repeat(100)], words, { maxTokens: 100, maxChars: 40 })).toEqual([
      'x'.repeat(40),
      'x'.repeat(40),
      'x'.repeat(20),
    ]);
  });

  it('returns nothing for no sentences', () => {
    expect(chunkSentences([], words, limits)).toEqual([]);
  });
});

describe('isHeading', () => {
  it('reads short unpunctuated lines as headings, and text-like lines as text', () => {
    expect(isHeading('Manufacturing')).toBe(true);
    expect(isHeading('Risks Related to Our Industry and Markets')).toBe(true);
    for (const text of [
      'the degree to which IP laws exist and are meaningfully enforced; and',
      'Our products and internal systems rely on software and hardware developed or',
      '• Asia Pacific',
      'lower case continuation of a wrapped line',
      'Operating margin % 29% 20% 26%',
      'Net revenue $ 53.1 billion',
      'We design chips.',
    ]) {
      expect(isHeading(text), text).toBe(false);
    }
  });
});

describe('runs', () => {
  it('splits at headings, keeps the heading lines as text, and drops only page furniture', () => {
    expect(
      runs([
        'We design chips.',
        'Manufacturing',
        'We utilize foundries, such as TSMC.',
        '8',
        'Table of Contents',
        '7 | 2025 10-K',
        'Lam Research Corporation 2026 10-K 7',
        'We purchase memory.',
        'Competition',
        'Our competitors include:',
        'AMD;',
      ]),
    ).toEqual([
      { heading: null, blocks: ['We design chips.'] },
      {
        heading: 'Manufacturing',
        blocks: ['Manufacturing', 'We utilize foundries, such as TSMC.', 'We purchase memory.'],
      },
      { heading: 'Competition', blocks: ['Competition', 'Our competitors include:', 'AMD;'] },
    ]);
  });

  it('keeps consecutive heading lines in one run, labelled by the last', () => {
    expect(
      runs(['Executive Officers', 'Andrew R. Jassy', 'President and CEO', 'Body text.']),
    ).toEqual([
      {
        heading: 'President and CEO',
        blocks: ['Executive Officers', 'Andrew R. Jassy', 'President and CEO', 'Body text.'],
      },
    ]);
  });

  it('loses no block except page furniture', () => {
    const list = [
      'Intro text.',
      'Heading A',
      'Subtitle',
      'Body, with a lead-in and',
      '• a bullet',
      '12',
      'Operating margin % 29% 20% 26%',
      'Heading B',
      'Last line without punctuation',
    ];
    const kept = runs(list).flatMap((r) => r.blocks);
    expect(kept).toEqual(list.filter((b) => b !== '12'));
  });
});

describe('chunkSections', () => {
  it('never crosses a heading, and embeds every chunk of a run with its heading', () => {
    const chunks = chunkSections(
      [
        {
          name: 'Item 1',
          blocks: ['We design chips.', 'Manufacturing', 'We use TSMC.', 'We sell them.'],
        },
        { name: 'Item 1A', blocks: ['We rely on TSMC.'] },
      ],
      words,
      { maxTokens: 8, maxChars: 2_000 },
    );
    expect(chunks).toEqual([
      { section: 'Item 1', heading: null, text: 'We design chips.', embedText: 'We design chips.' },
      {
        section: 'Item 1',
        heading: 'Manufacturing',
        text: 'Manufacturing We use TSMC.',
        embedText: 'Manufacturing We use TSMC.',
      },
      {
        section: 'Item 1',
        heading: 'Manufacturing',
        text: 'We sell them.',
        embedText: 'Manufacturing. We sell them.',
      },
      {
        section: 'Item 1A',
        heading: null,
        text: 'We rely on TSMC.',
        embedText: 'We rely on TSMC.',
      },
    ]);
  });

  it('counts the heading against the token limit', () => {
    const chunks = chunkSections(
      [{ name: 'Item 1', blocks: ['Supply Chain Risk', 'One two three four.', 'Five six seven.'] }],
      words,
      limits,
    );
    for (const chunk of chunks) expect(words(chunk.embedText)).toBeLessThanOrEqual(10);
  });
});
