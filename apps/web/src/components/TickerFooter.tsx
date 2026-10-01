import type { IngestStatus } from '@kesher/shared';
import { Fragment } from 'react';
import type { ApiStatus } from '../api/health';
import { formatDay } from '../view/format';
import { ingestView } from '../view/ingest';
import type { PriceReaction } from '../view/types';
import { Move } from './Move';

const API_LABEL: Record<ApiStatus, string> = {
  checking: 'Checking API',
  ok: 'API ok',
  unreachable: 'API unreachable',
};

interface Props {
  // The replayed session; null when nothing has been replayed yet.
  reaction: PriceReaction | null;
  apiStatus: ApiStatus;
  // Live ingestion on the api (GET /ingest/status); null until it answers.
  ingest?: IngestStatus | null;
}

// The replayed session's closing moves: the last window of each row.
export function TickerFooter({ reaction, apiStatus, ingest = null }: Props) {
  return (
    <footer
      aria-label="Replayed session"
      className="flex min-h-[34px] shrink-0 flex-wrap items-center gap-x-[22px] gap-y-1 border-t border-border bg-panel px-5 py-1.5 text-xs tabular-nums xl:h-[34px] xl:py-0"
    >
      {reaction ? (
        <>
          <span className="text-text-3">
            {formatDay(reaction.anchor.tradingDay, 'America/New_York')} session close
          </span>
          {reaction.rows.map((row) => (
            <span key={row.symbol} className="font-extrabold whitespace-nowrap">
              {row.symbol} <Move value={row.moves.at(-1) ?? null} />
            </span>
          ))}
        </>
      ) : (
        <span className="text-text-3">No replayed session</span>
      )}
      <span className="ml-auto flex items-center gap-[22px] text-text-3">
        {ingest && <IngestLine status={ingest} />}
        <span role="status" className="font-mono">
          {API_LABEL[apiStatus]}
        </span>
        <span>{reaction?.delayNote ?? 'SIP data, delayed 15 minutes'}</span>
      </span>
    </footer>
  );
}

// One line on live ingestion; the details open upward over the screen with today's counts, all
// counted by code. The summary is the control: 44px tall, overlapping the 34px footer's edges.
function IngestLine({ status }: { status: IngestStatus }) {
  const view = ingestView(status);
  return (
    <details className="group relative">
      <summary className="-my-[11px] flex min-h-[44px] cursor-pointer list-none items-center gap-1.5 whitespace-nowrap hover:text-text-2 [&::-webkit-details-marker]:hidden">
        <span>{view.summary}</span>
        <span aria-hidden="true" className="text-[10px] group-open:rotate-180">
          ▴
        </span>
      </summary>
      <div className="absolute right-0 bottom-full z-10 mb-2 w-[300px] rounded-[10px] border border-border bg-panel p-3 shadow-lg">
        <p className="mb-2 text-[13px] font-extrabold text-text">Live ingestion today</p>
        <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1">
          {view.rows.map((row) => (
            <Fragment key={row.label}>
              <dt className="text-text-3">{row.label}</dt>
              <dd className="text-right text-code">{row.value}</dd>
            </Fragment>
          ))}
        </dl>
      </div>
    </details>
  );
}
