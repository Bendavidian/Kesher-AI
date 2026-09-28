import type { Tier } from '@kesher/shared';

// Tier 1 chips use the supplier tint (docs/UI.md); the other tiers stay neutral.
export const TIER_CHIP: Record<Tier, string> = {
  1: 'bg-supplier-tint text-supplier',
  2: 'bg-border text-text-2',
  3: 'bg-border text-text-2',
};
