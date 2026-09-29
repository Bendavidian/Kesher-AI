import type { ApiStatus } from '../api/health';
import { formatDay } from '../view/format';
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
}

// The replayed session's closing moves: the last window of each row.
export function TickerFooter({ reaction, apiStatus }: Props) {
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
        <span role="status" className="font-mono">
          {API_LABEL[apiStatus]}
        </span>
        <span>{reaction?.delayNote ?? 'SIP data, delayed 15 minutes'}</span>
      </span>
    </footer>
  );
}
