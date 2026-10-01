import type { SourceProvider } from '@kesher/shared';
import { formatEt } from '../view/format';
import { TIER_LABEL, type EventView } from '../view/feed';
import type { PriceReaction } from '../view/types';
import { ConnectionPath } from './ConnectionPath';
import { CheckIcon } from './EvidenceCard';
import { ExtractionChips } from './ExtractionChips';
import { MarketTable } from './MarketTable';
import { OpenGapBars } from './OpenGapBars';

const PROVIDER_LABEL: Record<SourceProvider, string> = {
  alpaca: 'Alpaca',
  sec_edgar: 'SEC EDGAR',
};

function WhyYou({ view, replayKey }: { view: EventView; replayKey: string }) {
  const { path, evidence } = view;
  const heading = path.kind === 'none' ? 'Why this stays out of your feed' : 'Why this reached you';

  let footnote;
  if (path.kind === 'none') {
    footnote = <p className="text-xs text-text-2">{path.explanation}</p>;
  } else if (path.direct) {
    footnote = (
      <p className="text-xs text-text-2">
        {path.label}, so no relationship is needed to explain this one.
      </p>
    );
  } else {
    footnote = (
      <>
        {path.mention && <p className="text-xs text-text-2">{path.mention}</p>}
        {evidence.map((item) => (
          <p key={item.filingLabel} className="flex items-center gap-2 text-xs text-text-2">
            <CheckIcon size={14} />
            Edge evidence from the {item.filingLabel}. {item.reviewed ? 'Reviewed.' : ''}
          </p>
        ))}
      </>
    );
  }

  return (
    <div className="flex flex-col gap-3.5 rounded-panel border border-border bg-inset px-[18px] py-4">
      <h3 className="text-[13px] font-extrabold text-text-2">{heading}</h3>
      <ConnectionPath key={replayKey} path={path} />
      {footnote}
    </div>
  );
}

// The market table's place when the api sent no price reaction: an explained event outside the
// feed, or market data the api could not read. No number is shown that the api did not send.
function NoReaction() {
  return (
    <div className="flex flex-col gap-2.5">
      <h3 className="text-[13px] font-extrabold text-text-2">Market around the headline</h3>
      <p className="rounded-panel border border-dashed border-border-strong px-4 py-4 text-[13px] leading-normal text-text-3">
        No price reaction for this event. The moves appear here next to the benchmarks when market
        data is available.
      </p>
    </div>
  );
}

interface Props {
  view: EventView | null;
  // null until the event has a price reaction.
  reaction: PriceReaction | null;
  // Changes with the persona, so the connection path replays.
  replayKey: string;
  className?: string;
}

export function EventDetail({ view, reaction, replayKey, className = '' }: Props) {
  if (!view) {
    return (
      <section
        aria-label="Event"
        className={`flex flex-col rounded-panel border border-border bg-panel px-[22px] py-[18px] ${className}`}
      >
        <p className="rounded-button border border-dashed border-border-strong px-4 py-6 text-center text-sm text-text-3">
          Select an event from your feed.
        </p>
      </section>
    );
  }

  const { event, source } = view;
  const subject =
    reaction?.rows.find((row) => view.held.some((symbol) => symbol === row.symbol))?.symbol ??
    view.path.stations[0].title;

  return (
    <section
      aria-label="Event"
      className={`flex flex-col gap-3.5 rounded-panel border border-border bg-panel px-[22px] py-[18px] ${className}`}
    >
      <div className="flex flex-col gap-2.5">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-text-3">
          <span className="font-bold text-text-2">
            {source.wire ? `${source.wire} via ` : ''}
            {PROVIDER_LABEL[source.provider]}
          </span>
          <span className="rounded-chip bg-border px-2 py-0.5 font-bold text-text-2">
            {TIER_LABEL[source.tier]}
          </span>
          <span>{formatEt(source.publishedAt)}</span>
          <span className="font-mono">id {source.externalId}</span>
        </div>
        <h2 className="text-2xl leading-[1.25] font-extrabold">{event.headline}</h2>
        <ExtractionChips extraction={event.extraction} />
      </div>

      <WhyYou view={view} replayKey={replayKey} />
      {reaction ? (
        <>
          <MarketTable reaction={reaction} held={view.held} />
          <OpenGapBars reaction={reaction} subject={subject} />
        </>
      ) : (
        <NoReaction />
      )}
    </section>
  );
}
