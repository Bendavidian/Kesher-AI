import { createContext, useContext } from 'react';
import type { Viewer } from '../view/types';

// The viewer and the session state the screens share (SPEC.md decision log, T29). They live above
// the routes, so they survive a visit to another screen and a switch.
export interface Session {
  // null while the app checks whether the cookie is a guest's.
  viewer: Viewer | null;
  setViewer: (viewer: Viewer) => void;
  // The event of the last scored push, which the feed marks as replayed.
  lastScoredEventId: string | null;
  onScored: (eventId: string) => void;
}

// Anyone who is not a guest starts as persona A.
export const PERSONA_A: Viewer = { key: 'A', session: 0 };

export const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useSession needs a SessionProvider');
  return session;
}
