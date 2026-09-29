import { direction, formatPercent, type Direction } from '../view/format';

const MOVE_TEXT: Record<Direction, string> = {
  up: 'text-up',
  down: 'text-down',
  flat: 'text-text-2',
};

// A signed percentage in up or down color. Green and red mean only up or down. null is a window
// that is not ready yet (the data is delayed 15 minutes) or has no trade: a dash, never a number.
export function Move({ value }: { value: number | null }) {
  if (value === null) {
    return (
      <span className="text-text-3">
        <span aria-hidden="true">—</span>
        <span className="sr-only">not available yet</span>
      </span>
    );
  }
  return <span className={MOVE_TEXT[direction(value)]}>{formatPercent(value)}</span>;
}
