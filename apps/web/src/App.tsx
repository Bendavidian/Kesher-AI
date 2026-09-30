import { isGuest } from '@kesher/shared';
import { useEffect, useState } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router';
import { LiveDepsContext, useLiveDeps, type LiveDeps } from './live/deps';
import { FeedScreen } from './screens/FeedScreen';
import { NotFoundScreen } from './screens/NotFoundScreen';
import { ReportScreen } from './screens/ReportScreen';
import { RunScreen, RunsIndexScreen } from './screens/RunScreen';
import type { Viewer } from './view/types';

const PERSONA_A: Viewer = { key: 'A', session: 0 };

export function AppRoutes() {
  const { api } = useLiveDeps();
  // null until the app knows whether the cookie is a guest's: a guest who reloads keeps its
  // portfolio (T24). Anyone else starts as persona A, as before.
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

  return (
    <Routes>
      <Route
        path="/"
        element={
          <FeedScreen
            viewer={viewer}
            onViewerChange={setViewer}
            lastScoredEventId={lastScoredEventId}
            onScored={setLastScoredEventId}
          />
        }
      />
      <Route path="/reports/:reportId" element={<ReportScreen />} />
      <Route path="/runs" element={<RunsIndexScreen />} />
      <Route path="/runs/:runId" element={<RunScreen />} />
      <Route path="*" element={<NotFoundScreen />} />
    </Routes>
  );
}

// deps replaces the api and the socket, for tests.
export function App({ deps }: { deps?: LiveDeps }) {
  const routes = (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
  return deps ? <LiveDepsContext value={deps}>{routes}</LiveDepsContext> : routes;
}
