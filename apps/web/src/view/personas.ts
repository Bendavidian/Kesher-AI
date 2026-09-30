import { DEMO_PERSONAS, isGuest, type PublicUser } from '@kesher/shared';
import type { Persona, ViewerKey } from './types';

// The labels of the three seeded personas (SPEC.md, Demo universe and personas). Their holdings
// come from the api after sign in; these are only the words the screens show.
export interface PersonaLabels {
  key: ViewerKey;
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

// The visitor's own holdings on the public instance (SPEC.md decision log, T24).
export const GUEST_LABELS: PersonaLabels = {
  key: 'guest',
  displayName: 'Your portfolio',
  switcherLabel: 'Your portfolio',
  youLabel: 'Your portfolio',
};

// The switcher's options: the three personas, then the guest portfolio.
export const SWITCHER_LABELS: PersonaLabels[] = [...PERSONA_LABELS, GUEST_LABELS];

export function labelsFor(key: ViewerKey): PersonaLabels {
  return SWITCHER_LABELS.find((labels) => labels.key === key)!;
}

// The persona behind a signed in user, by the seeded email, or the guest portfolio for a guest;
// null for any other user.
export function personaFrom(user: PublicUser): Persona | null {
  const key = isGuest(user)
    ? 'guest'
    : DEMO_PERSONAS.find((persona) => persona.email === user.email)?.key;
  if (!key) return null;
  return {
    ...labelsFor(key),
    _id: user._id,
    displayName: user.displayName,
    holdings: user.holdings,
  };
}
