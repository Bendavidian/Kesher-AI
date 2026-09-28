import { useState } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router';
import { FeedScreen } from './screens/FeedScreen';
import { NotFoundScreen } from './screens/NotFoundScreen';
import { ReportScreen } from './screens/ReportScreen';
import { RunScreen } from './screens/RunScreen';
import type { PersonaKey } from './view/types';

export function AppRoutes() {
  const [personaKey, setPersonaKey] = useState<PersonaKey>('A');

  return (
    <Routes>
      <Route
        path="/"
        element={<FeedScreen personaKey={personaKey} onPersonaChange={setPersonaKey} />}
      />
      <Route path="/reports/:reportId" element={<ReportScreen />} />
      <Route path="/runs/:runId" element={<RunScreen />} />
      <Route path="*" element={<NotFoundScreen />} />
    </Routes>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}
