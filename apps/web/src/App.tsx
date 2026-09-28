import { useEffect, useState } from 'react';
import { fetchHealth, type ApiStatus } from './api/health';
import { EventDetail } from './components/EventDetail';
import { FeedList } from './components/FeedList';
import { PersonaSwitcher } from './components/PersonaSwitcher';
import { ScoresPanel } from './components/ScoresPanel';
import { TickerFooter } from './components/TickerFooter';
import { TopBar } from './components/TopBar';
import { DEMO_STORE, PERSONAS } from './fixtures';
import { buildFeedView } from './view/feed';
import type { PersonaKey } from './view/types';

export function App() {
  const [apiStatus, setApiStatus] = useState<ApiStatus>('checking');
  const [personaKey, setPersonaKey] = useState<PersonaKey>('A');
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void fetchHealth().then((status) => {
      if (active) setApiStatus(status);
    });
    return () => {
      active = false;
    };
  }, []);

  // Fixtures only until the T06 wiring step; the persona is local state, not a login.
  const persona = PERSONAS.find((p) => p.key === personaKey) ?? PERSONAS[0]!;
  const store = DEMO_STORE;
  const feed = buildFeedView(persona, store, selectedEventId);
  const replayed = store.events.find((event) => event._id === store.replayedEventId);

  // Desktop first: three panels from 1280px (xl). Below that they stack as feed, event, scores.
  return (
    <div className="flex min-h-screen flex-col xl:h-screen">
      <TopBar replayAt={replayed?.publishedAt ?? null}>
        <PersonaSwitcher personas={PERSONAS} value={personaKey} onChange={setPersonaKey} />
      </TopBar>
      <main className="flex flex-1 flex-col gap-3 p-3 xl:min-h-0 xl:flex-row">
        <FeedList
          persona={persona}
          visible={feed.visible}
          hidden={feed.hidden}
          selectedEventId={feed.selected?.event._id ?? null}
          onSelect={setSelectedEventId}
          className="xl:w-[360px] xl:shrink-0"
        />
        <EventDetail
          view={feed.selected}
          reaction={store.priceReaction}
          replayKey={personaKey}
          className="xl:min-w-0 xl:flex-1 xl:overflow-y-auto"
        />
        <ScoresPanel view={feed.selected} className="xl:w-[340px] xl:shrink-0" />
      </main>
      <TickerFooter reaction={store.priceReaction} apiStatus={apiStatus} />
    </div>
  );
}
