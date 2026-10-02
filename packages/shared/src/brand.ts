// Theme tokens (docs/UI.md) the mark is drawn in.
export type MarkToken = 'bg' | 'text' | 'supplier' | 'you';

interface MarkGeometry {
  size: number;
  line: { d: string; stroke: MarkToken; width: number };
  ring: { cx: number; cy: number; r: number; fill: MarkToken; stroke: MarkToken; width: number };
  dot: { cx: number; cy: number; r: number; fill: MarkToken };
}

// The Route mark (T25): a line from a company, the ring, to the user, the orange dot. The top bar
// draws it, `npm run brand` writes the favicon, the icons and the link preview image from it, and
// the api draws it on the report share card (T30), so every copy has this geometry. Units are the
// size by size viewBox; colors are token names. No imports, so the brand script reads this file
// directly under Node.
export const MARK = {
  size: 64,
  line: { d: 'M18 46 V31 Q18 18 31 18 H46', stroke: 'supplier', width: 7 },
  ring: { cx: 18, cy: 46, r: 7, fill: 'bg', stroke: 'text', width: 5 },
  dot: { cx: 46, cy: 18, r: 8.5, fill: 'you' },
} as const satisfies MarkGeometry;
