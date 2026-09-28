import type { Confidence, Source } from '@kesher/shared';

export type SourceTier = Pick<Source, 'tier' | 'publisher'>;

// SPEC.md confidence rule, computed by code from the event's sources: high with a Tier 1 source
// or two independent Tier 2 sources, medium with a single Tier 2 source, low with Tier 3 only.
// Tier 2 sources are independent when their publishers differ, so two items from one wire count
// once; sources without a publisher count as one.
export function confidenceFor(sources: readonly SourceTier[]): Confidence {
  if (sources.some((source) => source.tier === 1)) return 'high';
  const wires = new Set(sources.filter((s) => s.tier === 2).map((s) => s.publisher));
  if (wires.size >= 2) return 'high';
  return wires.size === 1 ? 'medium' : 'low';
}
