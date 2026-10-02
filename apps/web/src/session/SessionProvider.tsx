import { isGuest } from '@kesher/shared';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLiveDeps } from '../live/deps';
import type { Viewer } from '../view/types';
import { PERSONA_A, SessionContext, type Session } from './context';

export function SessionProvider({ children }: { children: ReactNode }) {
  const { api } = useLiveDeps();
  // null until the app knows whether the cookie is a guest's: a guest who reloads keeps its
  // portfolio (T24). Anyone else starts as persona A.
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [lastScoredEventId, setLastScoredEventId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api.me().then(
      (user) => {
        if (active)
          setViewer((v) => v ?? (isGuest(user) ? { key: 'guest', session: 0 } : PERSONA_A));
      },
      () => {
        if (active) setViewer((v) => v ?? PERSONA_A);
      },
    );
    return () => {
      active = false;
    };
  }, [api]);

  const session = useMemo<Session>(
    () => ({ viewer, setViewer, lastScoredEventId, onScored: setLastScoredEventId }),
    [viewer, lastScoredEventId],
  );
  return <SessionContext value={session}>{children}</SessionContext>;
}
