import { useEffect, useState } from 'react';
import { fetchHealth, type ApiStatus } from '../api/health';
import { EventDetail } from '../components/EventDetail';
import { FeedList } from '../components/FeedList';
import { PersonaSwitcher } from '../components/PersonaSwitcher';
import { ScoresPanel, type InvestigateRequest } from '../components/ScoresPanel';
import { TickerFooter } from '../components/TickerFooter';
import { ReplayButton, ReplayStatus, SearchBox, TopBar } from '../components/TopBar';
import { useLiveDeps } from '../live/deps';
import { useLiveFeed } from '../live/useLiveFeed';
import { buildFeedView } from '../view/feed';
import { labelsFor, PERSONA_LABELS, personaFrom } from '../view/personas';
import type { PersonaKey } from '../view/types';

const IDLE: InvestigateRequest = { busy: false, error: null };

interface InvestigateState extends InvestigateRequest {
  personaKey: PersonaKey;
  eventId: string;
}

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
  // The Replay control shows only where the api has the demo route (DEMO_MODE).
  const [demoMode, setDemoMode] = useState(false);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [replay, setReplay] = useState<{ busy: boolean; error: string | null }>({
    busy: false,
    error: null,
  });
  // Keyed by persona and event, so a request on one card never shows on another.
  const [investigate, setInvestigate] = useState<InvestigateState>({
    ...IDLE,
    personaKey,
    eventId: '',
  });
  const live = useLiveFeed(personaKey, lastScoredEventId, onScored);

  useEffect(() => {
    let active = true;
    void fetchHealth().then((health) => {
      if (!active) return;
      setApiStatus(health.status);
      setDemoMode(health.demoMode);
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

  // The api answers with the card, now running; pushes then carry it to done or failed.
  const onInvestigate = (eventId: string) => {
    const key = { personaKey, eventId };
    setInvestigate({ ...key, busy: true, error: null });
    api.investigate(eventId).then(
      (card) => {
        live.upsert(card);
        setInvestigate({ ...key, busy: false, error: null });
      },
      (error: unknown) =>
        setInvestigate({
          ...key,
          busy: false,
          error: error instanceof Error ? error.message : 'the research could not start',
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

  const selected = notice ? null : feed.selected;

  // Desktop first: three panels from 1280px (xl). Below that they stack as feed, event, scores.
  return (
    <div className="flex min-h-screen flex-col xl:h-screen">
      <TopBar current="feed" start={<SearchBox />}>
        {replayed && <ReplayStatus at={replayed.event.publishedAt} />}
        {demoMode && (
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
          view={selected}
          reaction={selected?.reaction ?? null}
          replayKey={personaKey}
          className="xl:min-w-0 xl:flex-1 xl:overflow-y-auto"
        />
        <ScoresPanel
          view={selected}
          investigate={
            selected &&
            investigate.eventId === selected.event._id &&
            investigate.personaKey === personaKey
              ? investigate
              : IDLE
          }
          onInvestigate={() => {
            if (selected) onInvestigate(selected.event._id);
          }}
          className="xl:w-[340px] xl:shrink-0"
        />
      </main>
      <TickerFooter reaction={selected?.reaction ?? null} apiStatus={apiStatus} />
    </div>
  );
}
