import { BENCHMARKS } from '@kesher/shared';
import { direction, formatPercent } from '../view/format';
import type { PriceReaction } from '../view/types';
import { Move } from './Move';

function spoken(value: number): string {
  const sign = { up: 'plus ', down: 'minus ', flat: '' }[direction(value)];
  return `${sign}${Math.abs(value).toFixed(2)} percent`;
}

// Timing only, next to the benchmarks. Never a cause (docs/UI.md, Copy rules).
function note(reaction: PriceReaction, subject: string): string | null {
  const first = (symbol: string) => reaction.rows.find((row) => row.symbol === symbol)?.moves[0];
  const value = first(subject);
  if (value === undefined) return null;
  // Benchmarks in table order.
  const benchmarks = reaction.rows
    .filter((row) => BENCHMARKS.some((symbol) => symbol === row.symbol))
    .map((row) => `${row.symbol} ${formatPercent(row.moves[0] ?? 0)}`);
  const others = `${benchmarks.join(', ')} in the same window.`;
  return reaction.anchor.kind === 'previous_close'
    ? `${subject} opened ${formatPercent(value)} from its previous close; ${others}`
    : `${subject} moved ${formatPercent(value)} from the headline price; ${others}`;
}

interface Props {
  reaction: PriceReaction;
  // The symbol the note is about: the held company on the path, or the event company.
  subject: string;
}

export function OpenGapBars({ reaction, subject }: Props) {
  const first = reaction.rows.map((row) => ({ symbol: row.symbol, value: row.moves[0] ?? 0 }));
  const scale = Math.max(...first.map((row) => Math.abs(row.value)), 0.01);
  const title =
    reaction.anchor.kind === 'previous_close'
      ? `${reaction.windows[0] ?? 'Open gap'} against the previous close`
      : `${reaction.windows[0] ?? 'First window'} against the headline price`;
  const summary = note(reaction, subject);

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-[13px] font-extrabold text-text-2">{title}</h3>
      <div
        role="img"
        aria-label={`${title}: ${first.map((row) => `${row.symbol} ${spoken(row.value)}`).join(', ')}`}
        className="flex flex-col gap-[7px]"
      >
        {first.map((row) => {
          const width = `${Math.round((Math.abs(row.value) / scale) * 100)}%`;
          const dir = direction(row.value);
          return (
            <div
              key={row.symbol}
              className="grid grid-cols-[52px_minmax(0,1fr)_minmax(0,1fr)_64px] items-center text-xs font-extrabold"
            >
              <span>{row.symbol}</span>
              <span className="flex h-3 justify-end border-r border-border-strong">
                {dir === 'down' && (
                  <span className="block h-3 rounded-l-[3px] bg-down" style={{ width }} />
                )}
              </span>
              <span className="flex h-3 justify-start">
                {dir === 'up' && (
                  <span className="block h-3 rounded-r-[3px] bg-up" style={{ width }} />
                )}
              </span>
              <span className="text-right tabular-nums">
                <Move value={row.value} />
              </span>
            </div>
          );
        })}
      </div>
      {summary && <p className="text-xs text-text-3">{summary}</p>}
    </div>
  );
}
