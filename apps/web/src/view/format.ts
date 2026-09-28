// Number and date formatting for the UI (docs/UI.md, Type and shape).

// U+2212. Percentages always use a true minus, never a hyphen.
export const MINUS = '−';

export type Direction = 'up' | 'down' | 'flat';

// Decided on the value as shown, so -0.001 is flat and prints 0.00%.
export function direction(percent: number): Direction {
  const rounded = Math.round(percent * 100) / 100;
  if (rounded > 0) return 'up';
  if (rounded < 0) return 'down';
  return 'flat';
}

export function formatPercent(percent: number): string {
  const digits = Math.abs(percent).toFixed(2);
  const sign = { up: '+', down: MINUS, flat: '' }[direction(percent)];
  return `${sign}${digits}%`;
}

export function formatScore(score: number): string {
  return score.toFixed(2);
}

const etFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

// Apr 2, 2024, 23:57 ET
export function formatEt(date: Date): string {
  return `${etFormat.format(date)} ET`;
}

const etTimeFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

// Apr 2, 15:59 ET
export function formatEtShort(date: Date): string {
  return `${formatDay(date, 'America/New_York', false)}, ${etTimeFormat.format(date)} ET`;
}

// An ISO date (2026-02-25) is a calendar day, so it is formatted in UTC to keep the day.
export function formatDay(day: string | Date, timeZone = 'UTC', withYear = true): string {
  const date = typeof day === 'string' ? new Date(`${day}T00:00:00Z`) : day;
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    month: 'short',
    day: 'numeric',
    year: withYear ? 'numeric' : undefined,
  }).format(date);
}

// Shared with the api, which renders the same "Why you" wording.
export { joinList } from '@kesher/shared';
