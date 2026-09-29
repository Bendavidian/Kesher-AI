import { etInstant, type PriceReaction } from '@kesher/shared';

// Test data only; nothing outside the tests imports this file.

// The demo reaction's shape, with one row and made up moves.
export const REACTION: PriceReaction = {
  anchor: {
    kind: 'previous_close',
    baseTime: new Date('2024-04-02T20:00:00Z'),
    tradingDay: '2024-04-03',
  },
  windows: [
    { name: 'open_gap', endsAt: etInstant('2024-04-03', '09:30') },
    { name: '15m', endsAt: etInstant('2024-04-03', '09:45') },
    { name: '2h', endsAt: etInstant('2024-04-03', '11:30') },
    { name: 'session_close', endsAt: etInstant('2024-04-03', '16:00') },
  ],
  rows: [
    {
      symbol: 'TSM',
      basePrice: 140,
      baseBarTime: etInstant('2024-04-02', '15:59'),
      moves: [
        { pct: -1.16, barTime: etInstant('2024-04-03', '09:30') },
        { pct: -0.38, barTime: etInstant('2024-04-03', '09:45') },
        { pct: null, barTime: null },
        { pct: null, barTime: null },
      ],
    },
  ],
  delayed: true,
  complete: false,
};
