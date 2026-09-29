import { DEMO_PERSONAS, type PersonaKey, type PublicUser } from '@kesher/shared';
import type { Persona } from './types';

// The labels of the three seeded personas (SPEC.md, Demo universe and personas). Their holdings
// come from the api after sign in; these are only the words the screens show.
export interface PersonaLabels {
  key: PersonaKey;
  displayName: string;
  switcherLabel: string;
  youLabel: string;
}

export const PERSONA_LABELS: PersonaLabels[] = [
  {
    key: 'A',
    displayName: 'Persona A, AI investor',
    switcherLabel: 'AI investor',
    youLabel: 'AI investor',
  },
  {
    key: 'B',
    displayName: 'Persona B, semiconductor investor',
    switcherLabel: 'Semiconductors',
    youLabel: 'Semiconductor investor',
  },
  {
    key: 'C',
    displayName: 'Persona C, unrelated investor',
    switcherLabel: 'Unrelated',
    youLabel: 'Unrelated investor',
  },
];

export function labelsFor(key: PersonaKey): PersonaLabels {
  return PERSONA_LABELS.find((labels) => labels.key === key)!;
}

// The persona behind a signed in user, by the seeded email; null for any other user.
export function personaFrom(user: PublicUser): Persona | null {
  const key = DEMO_PERSONAS.find((persona) => persona.email === user.email)?.key;
  if (!key) return null;
  return {
    ...labelsFor(key),
    _id: user._id,
    displayName: user.displayName,
    holdings: user.holdings,
  };
}
