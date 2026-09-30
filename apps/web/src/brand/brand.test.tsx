import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { TopBar } from '../components/TopBar';
import { MARK, type MarkToken } from './mark';

afterEach(cleanup);

const WEB_DIR = join(dirname(fileURLToPath(import.meta.url)), '../..');
const PUBLIC_ORIGIN = 'https://kesher-5ymr.onrender.com';

const read = (path: string) => readFileSync(join(WEB_DIR, path));
const html = new DOMParser().parseFromString(read('index.html').toString('utf8'), 'text/html');
const css = read('src/index.css').toString('utf8');

function token(name: MarkToken): string {
  const hex = new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6});`).exec(css)?.[1];
  if (!hex) throw new Error(`--color-${name} is missing from index.css`);
  return hex.toUpperCase();
}

function attribute(selector: string, name: string): string | null {
  return html.querySelector(selector)?.getAttribute(name) ?? null;
}

// The file under public/ that a URL of the app serves, on its own origin or the public one.
function publicPath(url: string): string {
  const path = url.startsWith(PUBLIC_ORIGIN) ? url.slice(PUBLIC_ORIGIN.length) : url;
  if (!path.startsWith('/')) throw new Error(`${url} is not a URL of the app`);
  return join('public', path);
}

// Width and height from a PNG's IHDR chunk.
function pngSize(data: Buffer): { width: number; height: number } {
  expect(data.subarray(1, 4).toString('ascii')).toBe('PNG');
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

const iconLinks = [...html.querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"]')];
const previewImages = ['meta[property="og:image"]', 'meta[name="twitter:image"]'].map((selector) =>
  attribute(selector, 'content'),
);
const linkedFiles = [...iconLinks.map((link) => link.getAttribute('href')), ...previewImages];

describe('index.html', () => {
  it('links the SVG favicon, its ICO fallback and the touch icon', () => {
    expect(iconLinks.map((link) => [link.getAttribute('rel'), link.getAttribute('href')])).toEqual([
      ['icon', '/favicon.ico'],
      ['icon', '/favicon.svg'],
      ['apple-touch-icon', '/apple-touch-icon.png'],
    ]);
    expect(attribute('link[href="/favicon.svg"]', 'type')).toBe('image/svg+xml');
  });

  it.each(linkedFiles)('finds %s in public/', (url) => {
    expect(url).toBeTruthy();
    expect(existsSync(join(WEB_DIR, publicPath(url ?? '')))).toBe(true);
  });

  it('points the preview card at og.png on the public origin', () => {
    expect(previewImages).toEqual([`${PUBLIC_ORIGIN}/og.png`, `${PUBLIC_ORIGIN}/og.png`]);
    expect(attribute('meta[property="og:url"]', 'content')).toBe(`${PUBLIC_ORIGIN}/`);
    expect(attribute('meta[name="twitter:card"]', 'content')).toBe('summary_large_image');
    expect(attribute('meta[name="description"]', 'content')).toBeTruthy();
    expect(html.title).toBe('Kesher AI');
  });

  it('sets the theme color to the bg token', () => {
    expect(attribute('meta[name="theme-color"]', 'content')).toBe(token('bg'));
  });
});

describe('icon files', () => {
  it('keeps a PNG of 16, 32 and 48 px in favicon.ico', () => {
    const ico = read('public/favicon.ico');
    const count = ico.readUInt16LE(4);
    const images = Array.from({ length: count }, (_, i) => {
      const entry = 6 + 16 * i;
      const offset = ico.readUInt32LE(entry + 12);
      const png = ico.subarray(offset, offset + ico.readUInt32LE(entry + 8));
      return { listed: ico.readUInt8(entry), ...pngSize(png) };
    });
    expect(images).toEqual(
      [16, 32, 48].map((size) => ({ listed: size, width: size, height: size })),
    );
  });

  it('draws the touch icon at 180 px', () => {
    expect(pngSize(read('public/apple-touch-icon.png'))).toEqual({ width: 180, height: 180 });
  });

  it('draws og.png at the size index.html declares', () => {
    expect(pngSize(read('public/og.png'))).toEqual({ width: 1200, height: 630 });
    expect(attribute('meta[property="og:image:width"]', 'content')).toBe('1200');
    expect(attribute('meta[property="og:image:height"]', 'content')).toBe('630');
  });
});

// The shapes' geometry, without their colors: attributes in the favicon, class names in the app.
function geometry(svg: Element) {
  const [ring, dot] = svg.querySelectorAll('circle');
  const pick = (element: Element | null | undefined, names: string[]) =>
    Object.fromEntries(names.map((name) => [name, element?.getAttribute(name) ?? null]));
  return {
    viewBox: svg.getAttribute('viewBox'),
    line: pick(svg.querySelector('path'), ['d', 'stroke-width', 'stroke-linecap']),
    ring: pick(ring, ['cx', 'cy', 'r', 'stroke-width']),
    dot: pick(dot, ['cx', 'cy', 'r']),
  };
}

const { size, line, ring, dot } = MARK;
const markGeometry = {
  viewBox: `0 0 ${size} ${size}`,
  line: { d: line.d, 'stroke-width': String(line.width), 'stroke-linecap': 'round' },
  ring: {
    cx: String(ring.cx),
    cy: String(ring.cy),
    r: String(ring.r),
    'stroke-width': String(ring.width),
  },
  dot: { cx: String(dot.cx), cy: String(dot.cy), r: String(dot.r) },
};

describe('the Route mark', () => {
  it('is drawn in favicon.svg on a bg square, in its token colors', () => {
    const svg = new DOMParser().parseFromString(
      read('public/favicon.svg').toString('utf8'),
      'image/svg+xml',
    ).documentElement;
    expect(geometry(svg)).toEqual(markGeometry);
    expect(svg.querySelector('rect')?.getAttribute('fill')).toBe(token('bg'));
    expect(svg.querySelector('path')?.getAttribute('stroke')).toBe(token(line.stroke));
    const [ringShape, dotShape] = svg.querySelectorAll('circle');
    expect(ringShape?.getAttribute('fill')).toBe(token(ring.fill));
    expect(ringShape?.getAttribute('stroke')).toBe(token(ring.stroke));
    expect(dotShape?.getAttribute('fill')).toBe(token(dot.fill));
  });

  it('is drawn in the top bar with the same geometry and its tokens as classes', () => {
    render(
      <MemoryRouter>
        <TopBar current="feed">{null}</TopBar>
      </MemoryRouter>,
    );
    const svg = screen.getByRole('link', { name: 'Kesher home' }).querySelector('svg');
    if (!svg) throw new Error('the top bar has no logo');
    expect(geometry(svg)).toEqual(markGeometry);
    const [ringShape, dotShape] = svg.querySelectorAll('circle');
    expect(svg.querySelector('path')?.classList).toContain(`stroke-${line.stroke}`);
    expect(ringShape?.classList).toContain(`fill-${ring.fill}`);
    expect(ringShape?.classList).toContain(`stroke-${ring.stroke}`);
    expect(dotShape?.classList).toContain(`fill-${dot.fill}`);
  });
});
