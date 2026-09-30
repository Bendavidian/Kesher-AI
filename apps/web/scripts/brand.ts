// T25: writes the favicon, the icons and the link preview image to apps/web/public from the Route
// mark (src/brand/mark.ts), in the theme token colors of src/index.css. Run it after a change to
// the mark or the tokens and commit the output: `npm run brand`. The Overpass files for the
// preview image are downloaded once from Google Fonts to the gitignored .cache/fonts.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import { MARK, type MarkToken } from '../src/brand/mark.ts';

const WEB_DIR = resolve(import.meta.dirname, '..');
const PUBLIC_DIR = join(WEB_DIR, 'public');
const FONT_DIR = resolve(WEB_DIR, '../../.cache/fonts');

const TAGLINE = 'Market news, explained for your portfolio.';
// The favicon's rounded square, in viewBox units.
const TILE_RADIUS = 14;
const ICO_SIZES = [16, 32, 48];
const TOUCH_SIZE = 180;
const OG = { width: 1200, height: 630 };

type Token = MarkToken | 'text-2';

function tokenColors(): Record<Token, string> {
  const css = readFileSync(join(WEB_DIR, 'src/index.css'), 'utf8');
  const read = (name: Token) => {
    const hex = new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6});`).exec(css)?.[1];
    if (!hex) throw new Error(`--color-${name} is missing from src/index.css`);
    return hex.toUpperCase();
  };
  return {
    bg: read('bg'),
    text: read('text'),
    'text-2': read('text-2'),
    supplier: read('supplier'),
    you: read('you'),
  };
}

const colors = tokenColors();

// The mark's three shapes, in viewBox units.
function markShapes(): string {
  const { line, ring, dot } = MARK;
  return [
    `<path d="${line.d}" fill="none" stroke="${colors[line.stroke]}" stroke-width="${line.width}" stroke-linecap="round"/>`,
    `<circle cx="${ring.cx}" cy="${ring.cy}" r="${ring.r}" fill="${colors[ring.fill]}" stroke="${colors[ring.stroke]}" stroke-width="${ring.width}"/>`,
    `<circle cx="${dot.cx}" cy="${dot.cy}" r="${dot.r}" fill="${colors[dot.fill]}"/>`,
  ].join('\n  ');
}

// The mark on a bg square, so it reads on light and dark tab bars. The touch icon's square has
// no radius: iOS rounds the corners itself and would show transparent ones as black.
function tile(radius: number): string {
  const size = MARK.size;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${radius}" fill="${colors.bg}"/>
  ${markShapes()}
</svg>
`;
}

// The link preview card: the mark above the wordmark and the tagline, centered on bg.
function ogCard(): string {
  const markSize = 168;
  const x = (OG.width - markSize) / 2;
  const scale = markSize / MARK.size;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${OG.width}" height="${OG.height}" viewBox="0 0 ${OG.width} ${OG.height}">
  <rect width="${OG.width}" height="${OG.height}" fill="${colors.bg}"/>
  <g transform="translate(${x} 118) scale(${scale})">
  ${markShapes()}
  </g>
  <text x="${OG.width / 2}" y="418" text-anchor="middle" font-family="Overpass" font-weight="800" font-size="104" letter-spacing="1" fill="${colors.text}">Kesher AI</text>
  <text x="${OG.width / 2}" y="494" text-anchor="middle" font-family="Overpass" font-weight="400" font-size="38" fill="${colors['text-2']}">${TAGLINE}</text>
</svg>
`;
}

function png(svg: string, width: number, fontFiles: string[] = []): Buffer {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: width },
    font: { fontFiles, loadSystemFonts: false, defaultFontFamily: 'Overpass' },
  });
  return resvg.render().asPng();
}

// An ICO whose entries are PNG files, which browsers and Windows since Vista read.
function ico(images: { size: number; png: Buffer }[]): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length + 16 * images.length;
  const entries = images.map(({ size, png }) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size, 0);
    entry.writeUInt8(size, 1);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    return entry;
  });
  return Buffer.concat([header, ...entries, ...images.map((image) => image.png)]);
}

// Google Fonts answers a client it does not know with one static TrueType file per weight.
async function overpass(weight: number): Promise<string> {
  const file = join(FONT_DIR, `overpass-${weight}.ttf`);
  if (existsSync(file)) return file;
  const css = await fetch(`https://fonts.googleapis.com/css2?family=Overpass:wght@${weight}`, {
    headers: { 'User-Agent': 'kesher-brand' },
  });
  if (!css.ok) throw new Error(`Google Fonts answered ${css.status} for Overpass ${weight}`);
  const url = /url\((https:\/\/fonts\.gstatic\.com\/[^)]+\.ttf)\)/.exec(await css.text())?.[1];
  if (!url) throw new Error(`no TrueType file for Overpass ${weight}`);
  const font = await fetch(url);
  if (!font.ok) throw new Error(`fonts.gstatic.com answered ${font.status} for Overpass ${weight}`);
  mkdirSync(FONT_DIR, { recursive: true });
  writeFileSync(file, Buffer.from(await font.arrayBuffer()));
  return file;
}

function write(name: string, data: string | Buffer) {
  writeFileSync(join(PUBLIC_DIR, name), data);
  console.log(`wrote public/${name}`);
}

const favicon = tile(TILE_RADIUS);
const fonts = await Promise.all([overpass(400), overpass(800)]);

mkdirSync(PUBLIC_DIR, { recursive: true });
write('favicon.svg', favicon);
write('favicon.ico', ico(ICO_SIZES.map((size) => ({ size, png: png(favicon, size) }))));
write('apple-touch-icon.png', png(tile(0), TOUCH_SIZE));
write('og.png', png(ogCard(), OG.width, fonts));
