import { BrowserRouter, Route, Routes } from 'react-router';
import { LiveDepsContext, type LiveDeps } from './live/deps';
import { FeedScreen } from './screens/FeedScreen';
import { NotFoundScreen } from './screens/NotFoundScreen';
import { ReportScreen } from './screens/ReportScreen';
import { RunScreen, RunsIndexScreen } from './screens/RunScreen';
import { SessionProvider } from './session/SessionProvider';
import { UiProvider } from './theme/UiProvider';

export function AppRoutes() {
  return (
    <UiProvider>
      <SessionProvider>
        <Routes>
          <Route path="/" element={<FeedScreen />} />
          <Route path="/reports/:reportId" element={<ReportScreen />} />
          <Route path="/runs" element={<RunsIndexScreen />} />
          <Route path="/runs/:runId" element={<RunScreen />} />
          <Route path="*" element={<NotFoundScreen />} />
        </Routes>
      </SessionProvider>
    </UiProvider>
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
