import type { Relevance } from './domain/common';

// Display bands for the code computed relevance, named like the SPEC.md eval labels. Placeholders
// until T16 calibrates them: high from 0.8, medium above 0, none at 0. Bands only label a score;
// they decide nothing.
export const RELEVANCE_HIGH = 0.8;

export type RelevanceBand = 'high' | 'medium' | 'none';

export function relevanceBand(relevance: Relevance): RelevanceBand {
  if (relevance <= 0) return 'none';
  return relevance >= RELEVANCE_HIGH ? 'high' : 'medium';
}
