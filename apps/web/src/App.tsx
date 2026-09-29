import { useState } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router';
import { LiveDepsContext, type LiveDeps } from './live/deps';
import { FeedScreen } from './screens/FeedScreen';
import { NotFoundScreen } from './screens/NotFoundScreen';
import { ReportScreen } from './screens/ReportScreen';
import { RunScreen } from './screens/RunScreen';
import type { PersonaKey } from './view/types';

export function AppRoutes() {
  const [personaKey, setPersonaKey] = useState<PersonaKey>('A');
  const [lastScoredEventId, setLastScoredEventId] = useState<string | null>(null);

  return (
    <Routes>
      <Route
        path="/"
        element={
          <FeedScreen
            personaKey={personaKey}
            onPersonaChange={setPersonaKey}
            lastScoredEventId={lastScoredEventId}
            onScored={setLastScoredEventId}
          />
        }
      />
      <Route path="/reports/:reportId" element={<ReportScreen />} />
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
