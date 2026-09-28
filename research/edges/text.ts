// Filing HTML to text, Item 1 and Item 1A, and sentences.
// flatText() reproduces htmlToText() from spike/checks/01-sec.ts, so every quote found here is a
// verbatim substring of the text the app will check quotes against.

const BLOCK = '\u0001';

function decode(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&rsquo;/g, '’')
    .replace(/&ldquo;/g, '“')
    .replace(/&rdquo;/g, '”')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–');
}

function strip(html: string, blockTag: string): string {
  return decode(
    html
      .replace(/<ix:header>[\s\S]*?<\/ix:header>/gi, ' ')
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<\/(p|div|tr|li|h[1-6]|table)\s*>|<br\s*\/?>/gi, blockTag)
      .replace(/<[^>]+>/g, ' '),
  );
}

const collapse = (s: string) => s.replace(/[ \s]+/g, ' ').trim();

export function flatText(html: string): string {
  return collapse(strip(html, ' '));
}

// Text blocks in document order: paragraphs, table rows, list items, headings.
export function blocks(html: string): string[] {
  return strip(html, BLOCK)
    .split(BLOCK)
    .map(collapse)
    .filter((b) => b.length > 0);
}

// Heading words may be split by styling spans ("B USINESS"), so letters allow one space between.
const spaced = (word: string) =>
  word
    .split(' ')
    .map((w) => [...w].join('\\s?'))
    .join('\\s+');
const heading = (item: string, title: string) =>
  new RegExp(
    `^(?:part\\s+i[,.]?\\s*)?item\\s*${item}\\s*[.:\\-–—]?\\s*${spaced(title)}\\s*\\.?$`,
    'i',
  );

const ITEM_1 = heading('1', 'business');
const ITEM_1A = heading('1A', 'risk factors');
const ITEM_1B = heading('1B', 'unresolved staff comments');
const ITEM_1C = heading('1C', 'cybersecurity');
const ITEM_2 = heading('2', 'properties');

// A heading is a whole block, or a block and the next one ("Item 1A." then "Risk Factors").
// Table of contents rows carry page numbers, so they never match.
function headingAt(list: string[], i: number, pattern: RegExp): boolean {
  const here = list[i] ?? '';
  return pattern.test(here) || pattern.test(`${here} ${list[i + 1] ?? ''}`);
}

export interface Sections {
  item1: string[];
  item1a: string[];
}

// For 10-Ks that do not follow the Item order and map Items to their own headings instead
// (Intel's "Form 10-K Cross-Reference Index"): whole-block start and end headings per section.
export interface Layout {
  item1: [RegExp, RegExp];
  item1a: [RegExp, RegExp];
}

function find(list: string[], pattern: RegExp, from: number): number {
  for (let i = from; i < list.length; i++) if (headingAt(list, i, pattern)) return i;
  return -1;
}

// The span between a start heading and the first end heading after it. Of all start headings,
// the one with the longest span is the body; table of contents entries give short spans.
function longest(list: string[], start: RegExp, ends: RegExp[]): [number, number] | undefined {
  let best: [number, number] | undefined;
  for (let s = find(list, start, 0); s >= 0; s = find(list, start, s + 1)) {
    const found = ends.map((p) => find(list, p, s + 1)).filter((e) => e > 0);
    const e = found.length ? Math.min(...found) : list.length;
    if (!best || e - s > best[1] - best[0]) best = [s, e];
  }
  return best;
}

export function sections(list: string[], layout?: Layout): Sections {
  if (layout) {
    const one = longest(list, layout.item1[0], [layout.item1[1]]);
    const risk = longest(list, layout.item1a[0], [layout.item1a[1]]);
    if (!one || !risk) throw new Error('Layout headings not found');
    return { item1: list.slice(one[0] + 1, one[1]), item1a: list.slice(risk[0] + 1, risk[1]) };
  }
  // Item 1 runs to the Item 1A heading, Item 1A to the first of Item 1B, 1C or 2.
  const whole = longest(list, ITEM_1, [ITEM_1B, ITEM_1C, ITEM_2]);
  const risk = whole ? find(list, ITEM_1A, whole[0] + 1) : -1;
  if (!whole || risk < 0 || risk > whole[1])
    throw new Error('Item 1 and Item 1A headings not found');
  return { item1: list.slice(whole[0] + 1, risk), item1a: list.slice(risk + 1, whole[1]) };
}

const BULLET_ONLY = /^[•●▪◦·○■◆➢\-–—*]+$/;
const LEADING_BULLETS = /^[•●▪◦·○■◆➢\-–—*\s]+/;
const TERMINAL = /[.!?]["”’)]*$/;
const CONTINUES = /(?:[:;,]|\b(?:and|or|including))$/;
// Abbreviations that are usually followed by more of the same sentence.
const ABBREVIATION =
  /(?:\be\.g|\bi\.e|\bU\.S|\bU\.K|\bNo|\bNos|\bvs|\bMr|\bMs|\bDr|\bSt|\bapprox)\.$/;
// A company suffix ends the sentence unless another suffix or a parenthesis follows:
// "Huawei Technologies Co. Ltd.", "GLOBALFOUNDRIES Inc. (GF)", "ASML Holding N.V. (ASML)".
const SUFFIX = /\b(?:Co|Corp|Inc|Ltd|N\.V|S\.A|B\.V|L\.P)\.$/;
const SUFFIX_CONTINUES = /^(?:\(|(?:Ltd|Limited|Inc|LLC|Co)\b)/;

// Sentences from a run of blocks. A block that ends like a list lead-in (":", ";", ",") joins
// the next block, so a bullet stays in the same sentence as the words that introduce it.
// Headings and other unpunctuated blocks end the current run.
export function sentences(list: string[]): string[] {
  const runs: string[] = [];
  let run = '';
  list.forEach((block, i) => {
    run = run ? `${run} ${block}` : block;
    const next = list[i + 1] ?? '';
    const joins =
      BULLET_ONLY.test(block) ||
      CONTINUES.test(block) ||
      TERMINAL.test(block) ||
      /^[a-z]/.test(next);
    if (!joins) {
      runs.push(run);
      run = '';
    }
  });
  if (run) runs.push(run);

  const out: string[] = [];
  for (const r of runs) {
    const parts = r.split(/(?<=[.!?]["”’)]?)\s+(?=["“(]?[A-Z0-9•●▪])/);
    let current = '';
    parts.forEach((part, i) => {
      current = current ? `${current} ${part}` : part;
      const next = parts[i + 1] ?? '';
      const continues =
        ABBREVIATION.test(current) || (SUFFIX.test(current) && SUFFIX_CONTINUES.test(next));
      if (!continues) {
        out.push(current);
        current = '';
      }
    });
    if (current) out.push(current);
  }
  return out.map((s) => s.replace(LEADING_BULLETS, '').trim()).filter((s) => s.length > 0);
}
