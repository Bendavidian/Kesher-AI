import { DEMO_PERSONAS, type PersonaKey, type PublicUser } from '@kesher/shared';
import { labelsFor } from '../view/personas';
import type { Persona } from '../view/types';

// The three seeded personas (SPEC.md, Demo universe and personas; apps/api/src/seed/config.ts), as
// the api returns them after sign in. Ids are fixed so tests are stable; the seed assigns real ones.
export const PUBLIC_USERS: Record<PersonaKey, PublicUser> = {
  A: {
    _id: '5b0f5a9e-8c1d-4f2a-9b3e-1a2b3c4d5e01',
    email: DEMO_PERSONAS[0].email,
    displayName: 'Persona A, AI investor',
    holdings: [
      { symbol: 'NVDA', quantity: 100 },
      { symbol: 'MSFT', quantity: 40 },
      { symbol: 'AMZN', quantity: 60 },
    ],
    interests: ['ai_accelerators', 'cloud', 'data_centers'],
  },
  B: {
    _id: '5b0f5a9e-8c1d-4f2a-9b3e-1a2b3c4d5e02',
    email: DEMO_PERSONAS[1].email,
    displayName: 'Persona B, semiconductor investor',
    holdings: [
      { symbol: 'AMD', quantity: 120 },
      { symbol: 'AVGO', quantity: 30 },
      { symbol: 'TSM', quantity: 80 },
      { symbol: 'ASML', quantity: 15 },
    ],
    interests: ['chip_design', 'foundry', 'semicap_equipment'],
  },
  C: {
    _id: '5b0f5a9e-8c1d-4f2a-9b3e-1a2b3c4d5e03',
    email: DEMO_PERSONAS[2].email,
    displayName: 'Persona C, unrelated investor',
    holdings: [
      { symbol: 'KO', quantity: 200 },
      { symbol: 'JNJ', quantity: 90 },
      { symbol: 'XOM', quantity: 110 },
    ],
    interests: ['consumer_staples', 'pharma', 'oil_gas'],
  },
};

export const PERSONAS: (Persona & { key: PersonaKey })[] = (['A', 'B', 'C'] as const).map((key) => {
  const { _id, displayName, holdings } = PUBLIC_USERS[key];
  return { ...labelsFor(key), key, _id, displayName, holdings };
});
