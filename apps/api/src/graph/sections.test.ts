import { describe, expect, it } from 'vitest';
import { blocks, flatText, sections, sentences, type Layout } from './sections';

const html = (...paragraphs: string[]) => paragraphs.map((p) => `<p>${p}</p>`).join('\n');

describe('blocks and flatText', () => {
  it('splits on block tags and decodes entities like normalizeText', () => {
    const doc = '<div>Item&#160;1.<span> Business</span></div><p>We use TSMC&amp;co.</p><br/>x';
    expect(blocks(doc)).toEqual(['Item 1. Business', 'We use TSMC&co.', 'x']);
    expect(flatText(doc)).toBe('Item 1. Business We use TSMC&co. x');
  });

  it('keeps every sentence built from blocks verbatim in the flat text', () => {
    const doc = html('Our suppliers include:', '• TSMC, for wafers;', 'and Samsung.', 'Next one.');
    const flat = flatText(doc);
    for (const sentence of sentences(blocks(doc))) expect(flat).toContain(sentence);
  });
});

describe('sections', () => {
  const tenK = [
    'Table of Contents',
    'Item 1. Business 4',
    'Item 1A. Risk Factors 12',
    'Part I',
    'Item 1. Business',
    'We design chips.',
    'Item 1A.',
    'Risk Factors',
    'We rely on TSMC.',
    'Item 1B. Unresolved Staff Comments',
    'None.',
  ];

  it('takes Item 1 and Item 1A from the body, not the table of contents', () => {
    expect(sections(tenK, { kind: 'items10k' })).toEqual([
      { name: 'Item 1', blocks: ['We design chips.'] },
      { name: 'Item 1A', blocks: ['We rely on TSMC.'] },
    ]);
  });

  it('matches headings split by styling spans', () => {
    const list = [
      'ITEM 1. B USINESS',
      'Body.',
      'ITEM 1A. RISK FACTORS',
      'Risk.',
      'ITEM 2. PROPERTIES',
    ];
    expect(sections(list, { kind: 'items10k' }).map((s) => s.blocks)).toEqual([
      ['Body.'],
      ['Risk.'],
    ]);
  });

  it('fails when the headings are missing', () => {
    expect(() => sections(['No items here.'], { kind: 'items10k' })).toThrow(/not found/);
  });

  it('reads a cross-reference layout by its own headings', () => {
    const layout: Layout = {
      kind: 'headings',
      sections: [
        { name: 'Item 1', start: /^Overview$/, end: /^Results$/ },
        { name: 'Item 1A', start: /^Risk Factors$/, end: /^Other$/ },
      ],
    };
    const list = [
      'Overview 3',
      'Risk Factors 37',
      'Overview',
      'Business.',
      'More.',
      'Results',
      'Risk Factors',
      'Risk.',
      'Other',
    ];
    expect(sections(list, layout)).toEqual([
      { name: 'Item 1', blocks: ['Business.', 'More.'] },
      { name: 'Item 1A', blocks: ['Risk.'] },
    ]);
  });

  it('takes Item 4 and Item 3.D from a 20-F', () => {
    const list = [
      'ITEM 3.',
      'KEY INFORMATION',
      'ITEM 4.',
      'INFORMATION ON THE COMPANY',
      'ITEM 4A.',
      'UNRESOLVED STAFF COMMENTS',
      'ITEM 3. KEY INFORMATION',
      'Capitalization and Indebtedness',
      'Not applicable.',
      'Risk Factors',
      'We depend on ASML.',
      'ITEM 4. INFORMATION ON THE COMPANY',
      'We are a foundry.',
      'We make wafers.',
      'ITEM 4A. UNRESOLVED STAFF COMMENTS',
      'None.',
    ];
    expect(sections(list, { kind: 'items20f' })).toEqual([
      { name: 'Item 4', blocks: ['We are a foundry.', 'We make wafers.'] },
      { name: 'Item 3.D', blocks: ['We depend on ASML.'] },
    ]);
  });

  describe('page layout', () => {
    const layout: Layout = {
      kind: 'pages',
      marker: /^Annual Report 2025$/,
      sections: [
        {
          name: 'Item 4',
          pages: [
            [2, 3],
            [5, 5],
          ],
        },
        { name: 'Item 3.D', pages: [[4, 4]] },
      ],
    };
    const page = (n: number, ...body: string[]) => ['Annual Report 2025', String(n), ...body];
    const list = [
      ...page(1, 'Cover.'),
      ...page(2, 'Two.'),
      ...page(3, 'Three.'),
      ...page(4, 'Four.'),
      ...page(5, 'Five.'),
      ...page(6, 'Six.'),
    ];

    it('collects the blocks of each page range, without the page markers', () => {
      expect(sections(list, layout)).toEqual([
        { name: 'Item 4', blocks: ['Two.', 'Three.', 'Five.'] },
        { name: 'Item 3.D', blocks: ['Four.'] },
      ]);
    });

    it('fails when a page inside a range has no marker', () => {
      const gap = [
        ...page(1),
        ...page(2, 'Two.'),
        'Three without a marker.',
        ...page(4),
        ...page(5),
      ];
      expect(() => sections(gap, layout)).toThrow('page 3 of 2 to 3 not found');
    });

    it('fails when a page of a range is missing, so a new report is not cut silently', () => {
      expect(() => sections(list.slice(0, 9), layout)).toThrow('page 5 of 5 to 5 not found');
    });
  });
});

describe('sentences', () => {
  it('keeps a bullet list in the sentence that introduces it', () => {
    expect(sentences(['Our current competitors include:', '•', 'AMD;', 'and Intel.'])).toEqual([
      'Our current competitors include: • AMD; and Intel.',
    ]);
  });

  it('does not split after company suffixes followed by more of the name, or abbreviations', () => {
    expect(
      sentences([
        'We use GLOBALFOUNDRIES Inc. (GF) and Huawei Technologies Co. Ltd. for parts, e.g. wafers. Next.',
      ]),
    ).toEqual([
      'We use GLOBALFOUNDRIES Inc. (GF) and Huawei Technologies Co. Ltd. for parts, e.g. wafers.',
      'Next.',
    ]);
  });

  it('ends a run at a heading', () => {
    expect(sentences(['Competition', 'We compete with AMD.'])).toEqual([
      'Competition',
      'We compete with AMD.',
    ]);
  });

  it('joins wrapped lines of a report converted from PDF', () => {
    const lines = [
      'We also compete with providers of applications that support or',
      'enhance complex patterning solutions, such as Applied Materials Inc. and KLA-Tencor',
      'Corporation.',
      'Our marketplace',
      'Short heading',
    ];
    expect(sentences(lines, { wrapped: true })).toEqual([
      'We also compete with providers of applications that support or enhance complex patterning solutions, such as Applied Materials Inc. and KLA-Tencor Corporation.',
      'Our marketplace',
      'Short heading',
    ]);
    // Without the option the capitalized continuation starts a new run.
    expect(sentences(lines).length).toBeGreaterThan(3);
  });
});
