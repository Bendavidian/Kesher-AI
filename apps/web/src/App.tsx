import { useEffect, useState } from 'react';
import { fetchHealth, type ApiStatus } from './api/health';
import { EmptyState, Panel } from './components/Panel';
import { TickerFooter } from './components/TickerFooter';
import { TopBar } from './components/TopBar';

export function App() {
  const [apiStatus, setApiStatus] = useState<ApiStatus>('checking');

  useEffect(() => {
    let active = true;
    void fetchHealth().then((status) => {
      if (active) setApiStatus(status);
    });
    return () => {
      active = false;
    };
  }, []);

  // Desktop first: three panels from 1280px (xl). Below that they stack as feed, event, scores.
  return (
    <div className="flex min-h-screen flex-col xl:h-screen">
      <TopBar apiStatus={apiStatus} />
      <main className="flex flex-1 flex-col gap-3 p-3 xl:min-h-0 xl:flex-row">
        <Panel id="feed" title="Your feed" className="xl:w-[360px] xl:shrink-0">
          <EmptyState>No events yet.</EmptyState>
        </Panel>
        <Panel id="event" title="Event" className="xl:min-w-0 xl:flex-1">
          <EmptyState>Select an event from your feed.</EmptyState>
        </Panel>
        <Panel
          as="aside"
          id="scores"
          title="Scores"
          label="Scores and evidence"
          className="xl:w-[340px] xl:shrink-0"
        >
          <EmptyState>Scores and evidence appear for the selected event.</EmptyState>
        </Panel>
      </main>
      <TickerFooter />
    </div>
  );
}
