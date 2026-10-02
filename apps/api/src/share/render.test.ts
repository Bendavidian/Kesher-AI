import { describe, expect, it } from 'vitest';
import { CARD, cardSvg } from './card';
import { renderPng } from './render';

describe('renderPng', () => {
  it('renders the card as a 1200 by 630 PNG from the committed fonts', () => {
    const png = renderPng(
      cardSvg({
        headline: 'TSMC pauses some production after the earthquake',
        path: 'TSMC supplies NVIDIA, and NVIDIA is in your portfolio',
        band: 'medium',
        claims: [{ type: 'fact', text: 'TSMC supplies NVIDIA.', sources: ['NVIDIA 10-K'] }],
        date: '29 Sep 2026',
      }),
    );
    expect(png.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    // IHDR: width and height right after the chunk header.
    expect(png.readUInt32BE(16)).toBe(CARD.width);
    expect(png.readUInt32BE(20)).toBe(CARD.height);
  });
});
