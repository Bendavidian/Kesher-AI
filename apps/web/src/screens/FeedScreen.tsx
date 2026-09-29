import { useEffect, useState } from 'react';
import { fetchHealth, type ApiStatus } from '../api/health';
import { EventDetail } from '../components/EventDetail';
import { FeedList } from '../components/FeedList';
import { PersonaSwitcher } from '../components/PersonaSwitcher';
import { ScoresPanel } from '../components/ScoresPanel';
import { TickerFooter } from '../components/TickerFooter';
import { ReplayButton, ReplayStatus, SearchBox, TopBar } from '../components/TopBar';
import { useLiveDeps } from '../live/deps';
import { useLiveFeed } from '../live/useLiveFeed';
import { buildFeedView } from '../view/feed';
import { labelsFor, PERSONA_LABELS, personaFrom } from '../view/personas';
import type { PersonaKey } from '../view/types';

interface Props {
  // The persona and the last scored event live above the routes, so they survive a visit to
  // another screen and a persona switch.
  personaKey: PersonaKey;
  onPersonaChange: (key: PersonaKey) => void;
  lastScoredEventId: string | null;
  onScored: (eventId: string) => void;
}

export function FeedScreen({ personaKey, onPersonaChange, lastScoredEventId, onScored }: Props) {
  const { api } = useLiveDeps();
  const [apiStatus, setApiStatus] = useState<ApiStatus>('checking');
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [replay, setReplay] = useState<{ busy: boolean; error: string | null }>({
    busy: false,
    error: null,
  });
  const live = useLiveFeed(personaKey, lastScoredEventId, onScored);

  useEffect(() => {
    let active = true;
    void fetchHealth().then((status) => {
      if (active) setApiStatus(status);
    });
    return () => {
      active = false;
    };
  }, []);

  const onReplay = () => {
    setReplay({ busy: true, error: null });
    api.replayDemo().then(
      () => setReplay({ busy: false, error: null }),
      (error: unknown) =>
        setReplay({
          busy: false,
          error: error instanceof Error ? error.message : 'the replay failed',
        }),
    );
  };

  // Until the api answers, the screen names the chosen persona with no holdings.
  const persona = (live.user && personaFrom(live.user)) ?? {
    ...labelsFor(personaKey),
    _id: '',
    holdings: [],
  };
  const feed = buildFeedView(
    persona,
    { cards: live.cards, explains: live.explains, replayedEventId: lastScoredEventId },
    selectedEventId,
  );
  const replayed = [...feed.visible, ...feed.hidden].find((entry) => entry.replayed);

  let notice: string | null = null;
  if (live.status === 'signing_in') notice = `Signing in as ${labelsFor(personaKey).displayName}.`;
  if (live.status === 'error') {
    notice = 'Could not load the feed. Check that the api is running, then choose a persona again.';
  }

  // Desktop first: three panels from 1280px (xl). Below that they stack as feed, event, scores.
  return (
    <div className="flex min-h-screen flex-col xl:h-screen">
      <TopBar current="feed" start={<SearchBox />}>
        {replayed && <ReplayStatus at={replayed.event.publishedAt} />}
        {import.meta.env.DEV && (
          <div className="flex items-center gap-2">
            <ReplayButton busy={replay.busy} onReplay={onReplay} />
            {replay.error && (
              <span role="alert" className="max-w-[220px] text-xs text-text-2">
                {replay.error}
              </span>
            )}
          </div>
        )}
        <PersonaSwitcher personas={PERSONA_LABELS} value={personaKey} onChange={onPersonaChange} />
      </TopBar>
      <main className="flex flex-1 flex-col gap-3 p-3 xl:min-h-0 xl:flex-row">
        <FeedList
          persona={persona}
          visible={feed.visible}
          hidden={feed.hidden}
          selectedEventId={feed.selected?.event._id ?? null}
          onSelect={setSelectedEventId}
          notice={notice}
          className="xl:w-[360px] xl:shrink-0"
        />
        <EventDetail
          view={notice ? null : feed.selected}
          // FeedCard.priceReaction stays null until market data is wired.
          reaction={null}
          replayKey={personaKey}
          className="xl:min-w-0 xl:flex-1 xl:overflow-y-auto"
        />
        <ScoresPanel view={notice ? null : feed.selected} className="xl:w-[340px] xl:shrink-0" />
      </main>
      <TickerFooter reaction={null} apiStatus={apiStatus} />
    </div>
  );
}
