import { describe, expect, it } from 'vitest';
import { normalizeText } from './text';

describe('normalizeText', () => {
  it('strips tags, scripts, styles and the inline XBRL header', () => {
    const html =
      '<ix:header><ix:hidden>dei</ix:hidden></ix:header><style>p{}</style><p>We rely on <b>TSMC</b>.</p><script>x()</script>';
    expect(normalizeText(html)).toBe('We rely on TSMC .');
  });

  it('decodes named and numeric entities', () => {
    expect(normalizeText('AT&amp;T &lt;b&gt; &quot;q&quot; &apos;s&apos; &#8217; &#x2014;')).toBe(
      'AT&T <b> "q" \'s\' ’ —',
    );
    expect(normalizeText('&rsquo;&ldquo;&rdquo;&mdash;&ndash;')).toBe('’“”—–');
  });

  it('decodes an escaped entity only once', () => {
    expect(normalizeText('&amp;lt;')).toBe('&lt;');
  });

  it('keeps unknown and out of range entities as written', () => {
    expect(normalizeText('&copy; &#99999999;')).toBe('&copy; &#99999999;');
  });

  it('collapses whitespace, including NBSP, and trims', () => {
    expect(normalizeText('  one two&nbsp;\n\tthree  ')).toBe('one two three');
  });

  it('leaves an already normalized seed quote unchanged', () => {
    const quote =
      'We utilize foundries, such as Taiwan Semiconductor Manufacturing Company Limited, or TSMC, and Samsung Electronics Co., Ltd., or Samsung, to produce our semiconductor wafers.';
    expect(normalizeText(quote)).toBe(quote);
  });

  it('returns an empty string for markup without text', () => {
    expect(normalizeText('<p> &nbsp; </p>')).toBe('');
  });
});
