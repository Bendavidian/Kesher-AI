import { formatScore, joinList } from '../view/format';
import { relevanceBand, type FeedEntry } from '../view/feed';
import type { Persona } from '../view/types';
import { MiniPath } from './ConnectionPath';

const PILL = {
  High: 'bg-you px-2 py-[3px] text-on-you',
  Medium: 'border border-you px-[7px] py-[2px] text-you',
  None: 'bg-border px-2 py-[3px] text-text-2',
} as const;

export function RelevancePill({ relevance }: { relevance: number }) {
  const band = relevanceBand(relevance);
  return (
    <span className={`rounded-chip text-[11px] font-extrabold tabular-nums ${PILL[band]}`}>
      {band} {formatScore(relevance)}
    </span>
  );
}

interface RowProps {
  entry: FeedEntry;
  selected: boolean;
  onSelect: (eventId: string) => void;
}

export function FeedRow({ entry, selected, onSelect }: RowProps) {
  const hidden = entry.item.relevance === 0;
  const timeClass = entry.replayed && !hidden ? 'font-bold text-you' : 'font-semibold text-text-3';
  const shape = hidden
    ? 'rounded-panel border border-border bg-raised px-3.5 text-text-2'
    : `border-b border-divider px-4 text-text ${selected ? 'bg-raised' : ''}`;
  return (
    <button
      type="button"
      aria-current={selected ? 'true' : undefined}
      onClick={() => onSelect(entry.event._id)}
      className={`flex min-h-11 w-full cursor-pointer flex-col gap-[7px] py-3 text-left hover:bg-raised focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-you ${shape}`}
    >
      <span className="flex w-full items-center justify-between gap-2.5">
        <span className={`text-xs ${timeClass}`}>
          {entry.replayed ? 'Replayed now' : 'Recorded'}
        </span>
        <RelevancePill relevance={entry.item.relevance} />
      </span>
      <span className="text-sm leading-[1.35] font-bold">{entry.event.headline}</span>
      <MiniPath path={entry.path} />
    </button>
  );
}

interface ListProps {
  persona: Persona;
  visible: FeedEntry[];
  hidden: FeedEntry[];
  selectedEventId: string | null;
  onSelect: (eventId: string) => void;
  className?: string;
}

export function FeedList({
  persona,
  visible,
  hidden,
  selectedEventId,
  onSelect,
  className = '',
}: ListProps) {
  const held = persona.holdings.map((holding) => holding.symbol);
  const count = `${visible.length} ${visible.length === 1 ? 'event' : 'events'}`;
  const subtitle =
    visible.length > 0
      ? `Events that connect to ${joinList(held)}`
      : `Nothing connects to ${joinList(held)}`;

  return (
    <section
      aria-labelledby="feed-title"
      className={`flex flex-col overflow-hidden rounded-panel border border-border bg-panel ${className}`}
    >
      <div className="flex flex-col gap-1 border-b border-border px-4 pt-3.5 pb-3">
        <div className="flex items-center justify-between">
          <h1 id="feed-title" className="text-[15px] font-extrabold">
            Your feed
          </h1>
          <span className="text-xs font-bold text-you tabular-nums">{count}</span>
        </div>
        <p className="text-xs text-text-3">{subtitle}</p>
      </div>
      <div className="flex justify-between border-b border-divider px-4 py-2 text-[11px] font-semibold text-text-3">
        <span>Event</span>
        <span>Relevance</span>
      </div>

      <div className="flex flex-col xl:min-h-0 xl:flex-1 xl:overflow-y-auto">
        {visible.length > 0 && (
          <ol className="flex flex-col">
            {visible.map((entry) => (
              <li key={entry.item._id}>
                <FeedRow
                  entry={entry}
                  selected={entry.event._id === selectedEventId}
                  onSelect={onSelect}
                />
              </li>
            ))}
          </ol>
        )}

        {(visible.length === 0 || hidden.length > 0) && (
          <div className="flex flex-col gap-3 p-4">
            {visible.length === 0 && (
              <div className="flex flex-col gap-1.5 rounded-panel border border-dashed border-border-strong p-4">
                <p className="text-[15px] font-extrabold">Nothing connects to your holdings yet</p>
                <p className="text-[13px] leading-normal text-text-2">
                  {hidden.length} recorded {hidden.length === 1 ? 'event' : 'events'} had no path to{' '}
                  {joinList(held, 'or')} within two stops, so Kesher keeps{' '}
                  {hidden.length === 1 ? 'it' : 'them'} out of your feed.
                </p>
              </div>
            )}
            {hidden.length > 0 && (
              <>
                <h2 className="text-xs font-bold text-text-3">Hidden for you</h2>
                <ol className="flex flex-col gap-2">
                  {hidden.map((entry) => (
                    <li key={entry.item._id}>
                      <FeedRow
                        entry={entry}
                        selected={entry.event._id === selectedEventId}
                        onSelect={onSelect}
                      />
                    </li>
                  ))}
                </ol>
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
