import type { EventType, Extraction } from '@kesher/shared';

const EVENT_TYPE_LABEL: Record<EventType, string> = {
  natural_disaster: 'Natural disaster',
  production_disruption: 'Production disruption',
  earnings: 'Earnings',
  guidance: 'Guidance',
  regulatory: 'Regulatory',
  m_and_a: 'M&A',
  product: 'Product',
  legal: 'Legal',
  macro: 'Macro',
  other: 'Other',
};

// Everything here was decided by the model, so every chip uses the model color (docs/UI.md).
function Chip({ children }: { children: string }) {
  return <span className="rounded-chip bg-model-tint px-[9px] py-1 text-model">{children}</span>;
}

export function ExtractionChips({ extraction }: { extraction: Extraction | null }) {
  if (!extraction) {
    return <p className="text-xs font-semibold text-text-3">Extraction pending</p>;
  }
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs font-bold">
      <Chip>{EVENT_TYPE_LABEL[extraction.eventType]}</Chip>
      {extraction.companies.map((company) => (
        <Chip key={company.symbol}>{`${company.symbol} impact ${company.impact}`}</Chip>
      ))}
      {extraction.themes.map((theme) => (
        <Chip key={theme}>{`Theme ${theme.replaceAll('_', ' ')}`}</Chip>
      ))}
      <Chip>{`Importance ${extraction.importance} of 5`}</Chip>
      <span className="font-semibold text-text-3">Extracted by the model</span>
    </div>
  );
}
