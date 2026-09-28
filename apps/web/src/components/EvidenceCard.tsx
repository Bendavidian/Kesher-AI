import type { Tier } from '@kesher/shared';
import { TIER_LABEL, type EvidenceView } from '../view/feed';

// Tier 1 chips use the supplier tint (docs/UI.md); the other tiers stay neutral.
const TIER_CHIP: Record<Tier, string> = {
  1: 'bg-supplier-tint text-supplier',
  2: 'bg-border text-text-2',
  3: 'bg-border text-text-2',
};

// Green here means verified: the edge was reviewed.
export function CheckIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" className="shrink-0">
      <path
        d="M3 8.5 L6.5 12 L13 4.5"
        className="fill-none stroke-up"
        strokeWidth="2.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function EvidenceCard({ evidence }: { evidence: EvidenceView }) {
  return (
    <figure className="flex flex-col gap-2.5 rounded-panel border border-border bg-inset px-3.5 py-3">
      <blockquote className="text-[13px] leading-[1.55] text-text">“{evidence.quote}”</blockquote>
      <figcaption className="flex flex-wrap items-center gap-2 text-[11px] text-text-2">
        <span className="font-bold">{evidence.filingLabel}</span>
        <span
          className={`rounded-[5px] px-[7px] py-0.5 font-extrabold ${TIER_CHIP[evidence.tier]}`}
        >
          {TIER_LABEL[evidence.tier]}
        </span>
        {evidence.reviewed && (
          <span className="flex items-center gap-1 font-extrabold text-up">
            <CheckIcon size={12} />
            Reviewed
          </span>
        )}
      </figcaption>
    </figure>
  );
}
