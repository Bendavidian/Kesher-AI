import {
  MARK,
  relevanceBand,
  whyYou,
  type Claim,
  type MarkToken,
  type ReportDetail,
} from '@kesher/shared';

// The report share card (SPEC.md decision log, T30): a 1200 by 630 image drawn from a fixed
// template by code, never by a model. Its text is the report's stored text, untrusted where it
// comes from outside (the headline) or from the model (claim text): every string is cleaned of
// control characters, escaped as XML and cut to a fixed length before it enters the SVG.

export const CARD = { width: 1200, height: 630 } as const;
export const MAX_CARD_CLAIMS = 3;

// Theme tokens of apps/web/src/index.css (docs/UI.md); card.test.ts checks they match.
export const CARD_COLORS = {
  bg: '#0B0E13',
  panel: '#12161D',
  border: '#242B36',
  text: '#E7EBF0',
  'text-2': '#AAB3C0',
  'text-3': '#7D8797',
  you: '#FF7A33',
  supplier: '#4F9CFF',
  'supplier-tint': '#102239',
  code: '#2DD4BF',
  'code-tint': '#0E2A27',
} as const;

export type CardClaimType = Extract<Claim['type'], 'fact' | 'metric'>;

export interface CardClaim {
  type: CardClaimType;
  text: string;
  // The titles of the sources it cites, in citation order.
  sources: string[];
}

export interface CardContent {
  headline: string | null;
  // The Why you sentence of the user's path; null when the card is gone.
  path: string | null;
  band: 'high' | 'medium' | null;
  claims: CardClaim[];
  // The report's day, UTC: 29 Sep 2026.
  date: string;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function cardDate(at: Date): string {
  return `${at.getUTCDate()} ${MONTHS[at.getUTCMonth()]} ${at.getUTCFullYear()}`;
}

// A claim's lines on the card: 20 px Overpass 400 across 984 px, at most two.
const CLAIM_WIDTH_EM = 48;
const CLAIM_LINES = 2;

// What the card shows of a report. Claims: supported facts and metrics in report order, each
// citing only sources the report lists and fitting the card whole, at most three; the report screen shows the same claims as
// supported. Inferences stay off the card, since one shown without its premises states a
// conclusion with nothing under it.
export function cardContent({ report, claims, sources, card }: ReportDetail): CardContent {
  const byId = new Map(claims.map((claim) => [claim._id, claim]));
  const titles = new Map(sources.map((source) => [source._id, source.title]));
  const shown: CardClaim[] = [];
  for (const id of report.sections.flatMap((section) => section.claimIds)) {
    const claim = byId.get(id);
    if (!claim || claim.status !== 'supported' || claim.type === 'inference') continue;
    if (!claim.sources.every((cited) => titles.has(cited.sourceId))) continue;
    // A claim is shown whole or not at all: a cut metric could lose its benchmarks.
    if (!fitsWhole(claim.text, CLAIM_WIDTH_EM, CLAIM_LINES)) continue;
    const cited = [...new Set(claim.sources.map((s) => titles.get(s.sourceId)!))];
    shown.push({ type: claim.type, text: claim.text, sources: cited });
    if (shown.length === MAX_CARD_CLAIMS) break;
  }

  const item = card?.item ?? null;
  const band = item ? relevanceBand(item.relevance) : 'none';
  return {
    headline: card?.event.headline ?? null,
    path: item?.path ? whyYou(item.path, item.path.eventCompany, []).label : null,
    band: band === 'none' ? null : band,
    claims: shown,
    date: cardDate(report.createdAt),
  };
}

// Control characters are not allowed in XML and a newline would not wrap anyway.
function clean(text: string): string {
  return (
    text
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001F\u007F]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// The width of a text in em, from the advance widths of the committed Overpass files measured by
// character class and rounded up: a little wider than the text renders, never narrower, so a
// line that fits here fits on the card. The same text always measures the same.
const EM: Record<
  400 | 800,
  { upper: number; lower: number; digit: number; space: number; other: number }
> = {
  400: { upper: 0.7, lower: 0.54, digit: 0.6, space: 0.24, other: 0.95 },
  800: { upper: 0.72, lower: 0.58, digit: 0.62, space: 0.26, other: 1.1 },
};
const NARROW = new Set([...',.;:\'"!|()[]-/']);

export function textEm(text: string, weight: 400 | 800): number {
  const em = EM[weight];
  let width = 0;
  for (const char of text) {
    if (char === ' ') width += em.space;
    else if (/[A-Z]/.test(char)) width += em.upper;
    else if (/[a-z]/.test(char)) width += em.lower;
    else if (/[0-9]/.test(char)) width += em.digit;
    else if (NARROW.has(char)) width += 0.45;
    else width += em.other;
  }
  return width;
}

// The longest start of the text that fits with an ellipsis after it.
function cut(text: string, widthEm: number, weight: 400 | 800): string {
  const chars = [...text];
  while (chars.length > 0 && textEm(`${chars.join('').trimEnd()}…`, weight) > widthEm) chars.pop();
  return `${chars.join('').trimEnd()}…`;
}

// Lines no wider than widthEm, broken between words, at most `max` lines; a cut text ends with an
// ellipsis.
export function wrap(
  text: string,
  widthEm: number,
  max: number,
  weight: 400 | 800 = 400,
): string[] {
  return layout(text, widthEm, max, weight).lines;
}

// Whether the text fits in the lines whole, with no ellipsis.
export function fitsWhole(
  text: string,
  widthEm: number,
  max: number,
  weight: 400 | 800 = 400,
): boolean {
  return !layout(text, widthEm, max, weight).cut;
}

function layout(
  text: string,
  widthEm: number,
  max: number,
  weight: 400 | 800,
): { lines: string[]; cut: boolean } {
  const fits = (line: string) => textEm(line, weight) <= widthEm;
  const words = clean(text).split(' ').filter(Boolean);
  const lines: string[] = [];
  let line = '';
  let wordCut = false;
  for (const word of words) {
    const piece = fits(word) ? word : cut(word, widthEm, weight);
    if (piece !== word) wordCut = true;
    const next = line ? `${line} ${piece}` : piece;
    if (fits(next)) {
      line = next;
      continue;
    }
    lines.push(line);
    line = piece;
    if (lines.length === max) break;
  }
  if (lines.length < max) {
    if (line) lines.push(line);
    return { lines, cut: wordCut };
  }
  // Cut: the last line gets the ellipsis, inside the width.
  const last = lines[max - 1]!;
  lines[max - 1] = fits(`${last}…`) ? `${last}…` : cut(last, widthEm, weight);
  return { lines, cut: true };
}

const BAND_LABEL = { high: 'High relevance', medium: 'Medium relevance' } as const;
const TYPE_LABEL: Record<CardClaimType, string> = { fact: 'FACT', metric: 'METRIC' };
// Fact supplier blue, metric code teal, as the report screen's type chips (docs/UI.md).
const TYPE_COLORS: Record<CardClaimType, { fill: string; text: string }> = {
  fact: { fill: CARD_COLORS['supplier-tint'], text: CARD_COLORS.supplier },
  metric: { fill: CARD_COLORS['code-tint'], text: CARD_COLORS.code },
};

const PAD = 60;
const FONT = 'font-family="Overpass"';

function text(
  x: number,
  y: number,
  size: number,
  weight: 400 | 800,
  color: string,
  content: string,
  anchor: 'start' | 'end' = 'start',
): string {
  const end = anchor === 'end' ? ' text-anchor="end"' : '';
  return `<text x="${x}" y="${y}" ${FONT} font-size="${size}" font-weight="${weight}" fill="${color}"${end}>${escapeXml(content)}</text>`;
}

function mark(x: number, y: number, size: number): string {
  const { line, ring, dot } = MARK;
  const color = (token: MarkToken) => CARD_COLORS[token];
  return [
    `<g transform="translate(${x} ${y}) scale(${size / MARK.size})">`,
    `<path d="${line.d}" fill="none" stroke="${color(line.stroke)}" stroke-width="${line.width}" stroke-linecap="round"/>`,
    `<circle cx="${ring.cx}" cy="${ring.cy}" r="${ring.r}" fill="${color(ring.fill)}" stroke="${color(ring.stroke)}" stroke-width="${ring.width}"/>`,
    `<circle cx="${dot.cx}" cy="${dot.cy}" r="${dot.r}" fill="${color(dot.fill)}"/>`,
    '</g>',
  ].join('');
}

// The card as SVG. The same content always gives the same string.
export function cardSvg(content: CardContent): string {
  const c = CARD_COLORS;
  const parts: string[] = [
    `<rect width="${CARD.width}" height="${CARD.height}" fill="${c.bg}"/>`,
    mark(PAD, 40, 48),
    text(PAD + 62, 76, 28, 800, c.text, 'Kesher AI'),
  ];
  if (content.band) {
    // Relevance is computed by code: the code color.
    const label = BAND_LABEL[content.band];
    const width = Math.round(textEm(label, 800) * 18 + 28);
    const x = CARD.width - PAD - width;
    parts.push(
      `<rect x="${x}" y="46" width="${width}" height="38" rx="6" fill="${c['code-tint']}"/>`,
      text(CARD.width - PAD - 16, 71, 18, 800, c.code, label, 'end'),
    );
  }

  let y = 150;
  for (const line of wrap(content.headline ?? 'Research report', 31, 2, 800)) {
    parts.push(text(PAD, y, 34, 800, c.text, line));
    y += 42;
  }
  if (content.path) {
    y += 4;
    for (const line of wrap(content.path, 53, 2)) {
      parts.push(text(PAD, y, 20, 400, c['text-2'], line));
      y += 28;
    }
  }
  y += 8;
  parts.push(
    `<rect x="${PAD}" y="${y}" width="${CARD.width - 2 * PAD}" height="2" fill="${c.border}"/>`,
  );
  y += 40;

  if (content.claims.length === 0) {
    parts.push(text(PAD, y, 20, 400, c['text-2'], 'No claim in this report passed verification.'));
  }
  for (const claim of content.claims) {
    const colors = TYPE_COLORS[claim.type];
    const label = TYPE_LABEL[claim.type];
    parts.push(
      `<rect x="${PAD}" y="${y - 19}" width="${label.length * 10 + 16}" height="26" rx="5" fill="${colors.fill}"/>`,
      text(PAD + 8, y, 14, 800, colors.text, label),
    );
    for (const line of wrap(claim.text, CLAIM_WIDTH_EM, CLAIM_LINES)) {
      parts.push(text(PAD + 96, y, 20, 400, c.text, line));
      y += 24;
    }
    parts.push(
      text(
        PAD + 96,
        y,
        15,
        400,
        c['text-3'],
        wrap(`Source: ${claim.sources.join('; ')}`, 64, 1)[0]!,
      ),
    );
    y += 34;
  }

  parts.push(
    text(PAD, CARD.height - 30, 15, 400, c['text-3'], 'Information, not advice.'),
    text(
      CARD.width - PAD,
      CARD.height - 30,
      15,
      400,
      c['text-3'],
      `Report of ${content.date}`,
      'end',
    ),
  );
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD.width}" height="${CARD.height}" viewBox="0 0 ${CARD.width} ${CARD.height}">`,
    ...parts,
    '</svg>',
  ].join('\n');
}
