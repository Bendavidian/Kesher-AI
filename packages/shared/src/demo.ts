import { z } from 'zod';

// The demo personas and the pinned demo item, shared by the seed and the web's persona switcher.

export const PersonaKey = z.enum(['A', 'B', 'C']);
export type PersonaKey = z.infer<typeof PersonaKey>;

// SPEC.md, Demo universe and personas. The seed owns the rest of each persona.
export const DEMO_PERSONAS = [
  { key: 'A', email: 'persona.a@kesher.example' },
  { key: 'B', email: 'persona.b@kesher.example' },
  { key: 'C', email: 'persona.c@kesher.example' },
] as const satisfies readonly { key: PersonaKey; email: string }[];

// Public on purpose: the persona switcher is a demo control over seeded users, not
// authentication (docs/UI.md). Only its scrypt hash is stored.
export const DEMO_PASSWORD = 'kesher-demo';

// The pinned demo item (SPEC.md Replay and recording). An Alpaca news id, not a Source._id.
export const DEMO_SOURCE_ID = '38062166';
