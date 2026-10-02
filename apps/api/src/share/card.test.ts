import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Claim, FeedPath, ReportDetail } from '@kesher/shared';
import { describe, expect, it } from 'vitest';
import {
  CARD_COLORS,
  cardContent,
  cardSvg,
  escapeXml,
  fitsWhole,
  textEm,
  wrap,
  type CardContent,
} from './card';

const at = new Date('2026-09-29T14:05:00Z');
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const reportId = id(100);

const claim = (n: number, fields: Partial<Claim> & Pick<Claim, 'type'>): Claim =>
  ({
    _id: id(n),
    reportId,
    origin: 'model',
    text: `Claim ${n}.`,
    status: 'supported',
    checks: [],
    createdAt: at,
    sources: [{ sourceId: id(1), quote: 'quoted' }],
    premises: [],
    ...(fields.type === 'metric' ? { figures: [] } : {}),
    ...fields,
  }) as Claim;

const path: FeedPath = {
  eventCompany: 'TSM',
  named: true,
  holding: 'NVDA',
  hops: [{ from: 'TSM', to: 'NVDA', type: 'supplier_of', weight: 0.8, relationshipId: id(50) }],
};

function detail(claims: Claim[], card: unknown = defaultCard): ReportDetail {
  return {
    report: {
      _id: reportId,
      runId: id(101),
      sections: [{ title: 'Findings', claimIds: claims.map((c) => c._id) }],
      openQuestions: [],
      omitted: [],
      createdAt: at,
    },
    claims,
    sources: [
      {
        _id: id(1),
        kind: 'filing',
        tier: 1,
        title: 'NVIDIA 10-K',
        citeLabel: 'NVIDIA 10-K',
        ref: 'a',
      },
      {
        _id: id(2),
        kind: 'market_data',
        tier: 1,
        title: 'SIP bars for TSM, NVDA, SMH and SPY',
        citeLabel: 'SIP bars',
        ref: 'b',
      },
    ],
    run: {} as ReportDetail['run'],
    card: card as ReportDetail['card'],
  };
}

const defaultCard = {
  event: { headline: 'TSMC pauses <some> production & checks fabs after "quake"' },
  item: { relevance: 0.8, path },
};

describe('the share card theme', () => {
  it('uses the token colors of the web theme', () => {
    const css = readFileSync(resolve(import.meta.dirname, '../../../web/src/index.css'), 'utf8');
    for (const [token, hex] of Object.entries(CARD_COLORS)) {
      const defined = new RegExp(`--color-${token}:\\s*(#[0-9a-fA-F]{6});`).exec(css)?.[1];
      expect(defined?.toUpperCase(), token).toBe(hex);
    }
  });
});

describe('cardContent', () => {
  it('takes supported facts and metrics in report order, at most three, with source titles', () => {
    const content = cardContent(
      detail([
        claim(10, { type: 'fact', text: 'TSMC supplies NVIDIA.' }),
        claim(11, { type: 'inference', premises: [id(10)], text: 'An inference.' }),
        claim(12, { type: 'fact', status: 'unverified' }),
        claim(13, { type: 'fact', status: 'removed' }),
        claim(14, { type: 'metric', sources: [{ sourceId: id(2), quote: null }] }),
        // Cites a source the report does not list, so the screen hides it too.
        claim(15, { type: 'fact', sources: [{ sourceId: id(9), quote: 'q' }] }),
        claim(16, {
          type: 'fact',
          sources: [
            { sourceId: id(1), quote: 'one' },
            { sourceId: id(1), quote: 'two' },
            { sourceId: id(2), quote: 'three' },
          ],
        }),
        claim(17, { type: 'fact' }),
      ]),
    );
    expect(content.claims).toEqual([
      { type: 'fact', text: 'TSMC supplies NVIDIA.', sources: ['NVIDIA 10-K'] },
      { type: 'metric', text: 'Claim 14.', sources: ['SIP bars for TSM, NVDA, SMH and SPY'] },
      {
        type: 'fact',
        text: 'Claim 16.',
        sources: ['NVIDIA 10-K', 'SIP bars for TSM, NVDA, SMH and SPY'],
      },
    ]);
  });

  it('leaves out a claim that does not fit the card whole, never cutting it', () => {
    const long = `NVDA opened ${'−1.07% below its previous close and '.repeat(8)}SMH −1.00%, SPY −0.22%.`;
    const content = cardContent(
      detail([
        claim(20, { type: 'metric', text: long, sources: [{ sourceId: id(2), quote: null }] }),
        claim(21, { type: 'fact', text: 'TSMC supplies NVIDIA.' }),
      ]),
    );
    expect(content.claims.map((c) => c.text)).toEqual(['TSMC supplies NVIDIA.']);
  });

  it('keeps the code metric of a two stock path, the longest one T20 writes', () => {
    const m1 =
      'TSM opened −1.16% below its previous close and NVDA opened −1.07% below its previous close; SMH −1.00%, SPY −0.22%.';
    expect(fitsWhole(m1, 48, 2)).toBe(true);
  });

  it('reads the headline, the Why you line, the band and the day from the report', () => {
    const content = cardContent(detail([]));
    expect(content).toEqual({
      headline: defaultCard.event.headline,
      path: 'TSMC supplies NVIDIA, and NVIDIA is in your portfolio',
      band: 'medium',
      claims: [],
      date: '29 Sep 2026',
    });
    expect(
      cardContent(
        detail([], {
          ...defaultCard,
          item: { relevance: 1, path: { ...path, hops: [], eventCompany: 'NVDA' } },
        }),
      ),
    ).toMatchObject({ band: 'high', path: 'You hold NVIDIA directly' });
  });

  it('leaves the headline, path and band out when the card is gone', () => {
    expect(cardContent(detail([], null))).toMatchObject({ headline: null, path: null, band: null });
  });
});

describe('escapeXml and wrap', () => {
  it('escapes every XML special character', () => {
    expect(escapeXml(`<a href="x">'&'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&apos;&amp;&apos;&lt;/a&gt;',
    );
  });

  it('breaks between words, within the width and the line count, and marks a cut', () => {
    // Lowercase is 0.54 em and a space 0.24 em in Overpass 400.
    expect(wrap('one two three four', 5, 3)).toEqual(['one two', 'three', 'four']);
    expect(wrap('one two three four five six', 5, 2)).toEqual(['one two', 'three…']);
    expect(wrap('a\u0000b\nc  d', 20, 1)).toEqual(['a b c d']);
    expect(wrap('abcdefghijklmnop', 3.5, 2)).toEqual(['abcd…']);
    expect(wrap('', 10, 2)).toEqual([]);
  });

  it('measures capitals wider, so a headline in capitals never runs past the card', () => {
    expect(textEm('NVIDIA', 800)).toBeGreaterThan(textEm('nvidia', 800));
    const caps = 'WALL STREET RALLIES AS NVIDIA, AMD AND TSMC SURGE ON AI DEMAND WORLDWIDE';
    for (const line of wrap(caps, 31, 2, 800)) expect(textEm(line, 800)).toBeLessThanOrEqual(31);
  });
});

describe('cardSvg', () => {
  const content: CardContent = {
    headline: '<script>alert(1)</script> TSMC & "NVIDIA"',
    path: 'TSMC supplies NVIDIA, and NVIDIA is in your portfolio',
    band: 'medium',
    claims: [
      {
        type: 'fact',
        text: 'TSMC supplies NVIDIA, according to NVIDIA’s 10-K.',
        sources: ['NVIDIA 10-K'],
      },
      {
        type: 'metric',
        text: 'TSM opened −1.16% below its previous close; SMH −1.00%, SPY −0.22%.',
        sources: ['SIP bars'],
      },
    ],
    date: '29 Sep 2026',
  };

  it('gives the same SVG for the same content', () => {
    expect(cardSvg(content)).toBe(cardSvg(structuredClone(content)));
  });

  it('escapes untrusted text, so it never becomes markup', () => {
    const svg = cardSvg(content);
    expect(svg).not.toContain('<script');
    expect(svg).toContain('&lt;script&gt;alert(1)&lt;/script&gt; TSMC &amp; &quot;NVIDIA&quot;');
  });

  it('shows the mark, the band, the claims with their sources and the advice line', () => {
    const svg = cardSvg(content);
    expect(svg).toContain('Kesher AI');
    expect(svg).toContain('Medium relevance');
    expect(svg).toContain('>FACT<');
    expect(svg).toContain('>METRIC<');
    expect(svg).toContain('SPY −0.22%.');
    expect(svg).toContain('Source: NVIDIA 10-K');
    expect(svg).toContain('Information, not advice.');
    expect(svg).toContain('Report of 29 Sep 2026');
    expect(svg).not.toMatch(/href|<image|url\(/);
  });

  it('says so when no claim passed verification', () => {
    expect(cardSvg({ ...content, claims: [], band: null })).toContain(
      'No claim in this report passed verification.',
    );
  });
});
