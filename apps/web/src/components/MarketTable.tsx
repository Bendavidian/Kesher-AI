import { formatEtShort } from '../view/format';
import type { PriceReaction } from '../view/types';
import { Move } from './Move';

function anchorNote({ anchor, delayNote }: PriceReaction): string {
  const base = formatEtShort(anchor.baseAt);
  return anchor.kind === 'previous_close'
    ? `The headline came outside the regular session, so moves are measured from the previous regular close, ${base}. ${delayNote}.`
    : `The headline came during the regular session, so moves are measured from the price at the headline, ${base}. ${delayNote}.`;
}

interface Props {
  reaction: PriceReaction;
  held: readonly string[];
}

export function MarketTable({ reaction, held }: Props) {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="text-[13px] font-extrabold text-text-2">Market around the headline</h3>
        <span className="text-xs text-text-3">Shows what moved at the same time, not why.</span>
      </div>
      <p className="text-xs leading-normal text-text-3">{anchorNote(reaction)}</p>
      <div className="overflow-x-auto rounded-panel border border-border">
        <table className="w-full border-collapse text-[13px] tabular-nums">
          <thead>
            <tr className="bg-inset">
              <th
                scope="col"
                className="px-3.5 py-[9px] text-left text-[11px] font-bold text-text-3"
              >
                Symbol
              </th>
              {reaction.windows.map((window) => (
                <th
                  key={window}
                  scope="col"
                  className="px-3.5 py-[9px] text-right text-[11px] font-bold whitespace-nowrap text-text-3"
                >
                  {window}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {reaction.rows.map((row) => {
              const isHeld = held.includes(row.symbol);
              return (
                <tr
                  key={row.symbol}
                  className={`border-t border-divider ${isHeld ? 'bg-you-tint' : ''}`}
                >
                  <th
                    scope="row"
                    className={`px-3.5 py-[9px] text-left font-extrabold ${isHeld ? 'text-you' : ''}`}
                  >
                    {row.symbol}
                    {isHeld && <span className="sr-only">, you hold</span>}
                  </th>
                  {row.moves.map((move, index) => (
                    <td key={index} className="px-3.5 py-[9px] text-right font-bold">
                      <Move value={move} />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
