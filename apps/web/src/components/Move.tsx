import { direction, formatPercent, type Direction } from '../view/format';

const MOVE_TEXT: Record<Direction, string> = {
  up: 'text-up',
  down: 'text-down',
  flat: 'text-text-2',
};

// A signed percentage in up or down color. Green and red mean only up or down.
export function Move({ value }: { value: number }) {
  return <span className={MOVE_TEXT[direction(value)]}>{formatPercent(value)}</span>;
}
