import { normalizeText } from '@kesher/shared';

// Filing HTML to text blocks, the sections the graph job reads, and sentences. Ported from
// research/edges/text.ts. Blocks come from the same normalizeText that Source.text and the quote
// checks use, so a sentence built from blocks is verbatim in flatText (callers still check).

export type SectionName = 'Item 1' | 'Item 1A' | 'Item 3.D' | 'Item 4';

// items10k: Item 1 and Item 1A by their headings. items20f: Item 3.D (Risk Factors) and Item 4.
// headings: for reports that map Items to their own headings (Intel's cross-reference index).
// pages: for reports converted from PDF that map Items to page ranges (ASML).
export type Layout =
  | { kind: 'items10k' }
  | { kind: 'items20f' }
  | { kind: 'headings'; sections: { name: SectionName; start: RegExp; end: RegExp }[] }
  | {
      kind: 'pages';
      // The running header that opens every page; the next block is the page number.
      marker: RegExp;
      sections: { name: SectionName; pages: [number, number][] }[];
    };

export interface Section {
  name: SectionName;
  blocks: string[];
}

const BLOCK = '\u0001';
const BLOCK_END = /<\/(p|div|tr|li|h[1-6]|table)\s*>|<br\s*\/?>/gi;

// The whole filing as one normalized text: what every quote must be found in.
export function flatText(html: string): string {
  return normalizeText(html);
}

// Text blocks in document order: paragraphs, table rows, list items, headings.
export function blocks(html: string): string[] {
  return normalizeText(html.replace(BLOCK_END, ` ${BLOCK} `))
    .split(BLOCK)
    .map((b) => b.trim())
    .filter((b) => b.length > 0);
}

// Heading words may be split by styling spans ("B USINESS"), so letters allow one space between.
const spaced = (words: string) =>
  words
    .split(' ')
    .map((w) => [...w].map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s?'))
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
const ITEM_3 = heading('3', 'key information');
const ITEM_4 = heading('4', 'information on the company');
const ITEM_4A = heading('4A', 'unresolved staff comments');
const ITEM_5 = heading('5', 'operating and financial review');
const RISK_FACTORS = /^(?:D\.\s*)?Risk Factors$/i;

// A heading is a whole block, or a block and the next one ("Item 1A." then "Risk Factors").
// Table of contents rows carry page numbers, so they never match. Returns the number of blocks
// the heading spans, 0 when there is none at i.
function headingAt(list: readonly string[], i: number, pattern: RegExp): number {
  const here = list[i] ?? '';
  if (pattern.test(here)) return 1;
  return i + 1 < list.length && pattern.test(`${here} ${list[i + 1] ?? ''}`) ? 2 : 0;
}

interface Heading {
  at: number;
  // The first block after the heading.
  body: number;
}

function find(list: readonly string[], pattern: RegExp, from: number): Heading | null {
  for (let i = from; i < list.length; i++) {
    const length = headingAt(list, i, pattern);
    if (length > 0) return { at: i, body: i + length };
  }
  return null;
}

interface Span extends Heading {
  // Exclusive: the next heading, or the end of the document.
  end: number;
}

// The span between a start heading and the first end heading after it. Of all start headings,
// the one with the longest span is the body; table of contents entries give short spans.
function longest(list: readonly string[], start: RegExp, ends: readonly RegExp[]): Span | null {
  let best: Span | null = null;
  for (let s = find(list, start, 0); s; s = find(list, start, s.at + 1)) {
    const found = ends.flatMap((p) => find(list, p, s.body)?.at ?? []);
    const end = found.length ? Math.min(...found) : list.length;
    if (!best || end - s.at > best.end - best.at) best = { ...s, end };
  }
  return best;
}

function byPages(list: readonly string[], layout: Extract<Layout, { kind: 'pages' }>): Section[] {
  const pageOf: (number | null)[] = [];
  let page: number | null = null;
  for (let i = 0; i < list.length; i++) {
    const next = list[i + 1] ?? '';
    if (layout.marker.test(list[i] ?? '') && /^\d{1,4}$/.test(next)) {
      page = Number(next);
      pageOf.push(null, null);
      i++;
      continue;
    }
    pageOf.push(page);
  }
  const seen = new Set(pageOf.filter((p) => p !== null));
  return layout.sections.map(({ name, pages }) => {
    // Every page of a range must be found, so a new report is never cut silently.
    for (const [from, to] of pages) {
      for (let p = from; p <= to; p++) {
        if (!seen.has(p)) throw new Error(`${name}: page ${p} of ${from} to ${to} not found`);
      }
    }
    const inRange = (p: number | null) =>
      p !== null && pages.some(([from, to]) => p >= from && p <= to);
    return { name, blocks: list.filter((_, i) => inRange(pageOf[i] ?? null)) };
  });
}

export function sections(list: readonly string[], layout: Layout): Section[] {
  switch (layout.kind) {
    case 'headings':
      return layout.sections.map(({ name, start, end }) => {
        const span = longest(list, start, [end]);
        if (!span) throw new Error(`${name}: layout headings not found`);
        return { name, blocks: list.slice(span.body, span.end) };
      });
    case 'pages':
      return byPages(list, layout);
    case 'items10k': {
      // Item 1 runs to the Item 1A heading, Item 1A to the first of Item 1B, 1C or 2.
      const whole = longest(list, ITEM_1, [ITEM_1B, ITEM_1C, ITEM_2]);
      const risk = whole && find(list, ITEM_1A, whole.body);
      if (!whole || !risk || risk.at >= whole.end) {
        throw new Error('Item 1 and Item 1A headings not found');
      }
      return [
        { name: 'Item 1', blocks: list.slice(whole.body, risk.at) },
        { name: 'Item 1A', blocks: list.slice(risk.body, whole.end) },
      ];
    }
    case 'items20f': {
      // Item 3.D runs from its Risk Factors heading to Item 4; Item 4 runs to Item 4A or 5.
      const key = longest(list, ITEM_3, [ITEM_4]);
      const risk = key && find(list, RISK_FACTORS, key.body);
      const info = longest(list, ITEM_4, [ITEM_4A, ITEM_5]);
      if (!key || !risk || risk.at >= key.end || !info) {
        throw new Error('Item 3.D and Item 4 headings not found');
      }
      return [
        { name: 'Item 4', blocks: list.slice(info.body, info.end) },
        { name: 'Item 3.D', blocks: list.slice(risk.body, key.end) },
      ];
    }
  }
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
// In reports converted from PDF every printed line is a block. A line this long that does not
// end a sentence continues on the next one; shorter unpunctuated blocks are headings.
const WRAPPED_LINE = 40;

export interface SentenceOptions {
  wrapped?: boolean;
}

// Sentences from a run of blocks. A block that ends like a list lead-in (":", ";", ",") joins
// the next block, so a bullet stays in the same sentence as the words that introduce it.
// Headings and other unpunctuated blocks end the current run.
export function sentences(list: readonly string[], options: SentenceOptions = {}): string[] {
  const runs: string[] = [];
  let run = '';
  list.forEach((block, i) => {
    run = run ? `${run} ${block}` : block;
    const next = list[i + 1] ?? '';
    const joins =
      BULLET_ONLY.test(block) ||
      CONTINUES.test(block) ||
      TERMINAL.test(block) ||
      /^[a-z]/.test(next) ||
      (options.wrapped === true && block.length >= WRAPPED_LINE);
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
