import { resolve } from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import { CARD } from './card';

// Overpass 400 and 800, committed with their OFL license (assets/fonts/OFL.txt): the host has no
// fonts of its own, and system fonts would make the card differ between machines.
const FONT_DIR = resolve(import.meta.dirname, '../../assets/fonts');
const FONT_FILES = ['overpass-400.ttf', 'overpass-800.ttf'].map((name) => resolve(FONT_DIR, name));

// The card's SVG as a PNG at its own size. The SVG references no file and no URL.
export function renderPng(svg: string): Buffer {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: CARD.width },
    font: { fontFiles: FONT_FILES, loadSystemFonts: false, defaultFontFamily: 'Overpass' },
  });
  return resvg.render().asPng();
}
