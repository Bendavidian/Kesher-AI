import type { Persona } from '../view/types';

// The three seeded personas (SPEC.md, Demo universe and personas; apps/api/src/seed/config.ts).
// Ids are fixed so tests are stable; the seed assigns real ones.
export const PERSONAS: Persona[] = [
  {
    _id: '5b0f5a9e-8c1d-4f2a-9b3e-1a2b3c4d5e01',
    key: 'A',
    displayName: 'Persona A, AI investor',
    switcherLabel: 'AI investor',
    youLabel: 'AI investor',
    holdings: [
      { symbol: 'NVDA', quantity: 100 },
      { symbol: 'MSFT', quantity: 40 },
      { symbol: 'AMZN', quantity: 60 },
    ],
  },
  {
    _id: '5b0f5a9e-8c1d-4f2a-9b3e-1a2b3c4d5e02',
    key: 'B',
    displayName: 'Persona B, semiconductor investor',
    switcherLabel: 'Semiconductors',
    youLabel: 'Semiconductor investor',
    holdings: [
      { symbol: 'AMD', quantity: 120 },
      { symbol: 'AVGO', quantity: 30 },
      { symbol: 'TSM', quantity: 80 },
      { symbol: 'ASML', quantity: 15 },
    ],
  },
  {
    _id: '5b0f5a9e-8c1d-4f2a-9b3e-1a2b3c4d5e03',
    key: 'C',
    displayName: 'Persona C, unrelated investor',
    switcherLabel: 'Unrelated',
    youLabel: 'Unrelated investor',
    holdings: [
      { symbol: 'KO', quantity: 200 },
      { symbol: 'JNJ', quantity: 90 },
      { symbol: 'XOM', quantity: 110 },
    ],
  },
];
