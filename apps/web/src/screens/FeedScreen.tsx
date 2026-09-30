import { UniverseSymbol } from '@kesher/shared';
import { useEffect, useState } from 'react';
import { fetchHealth, type ApiStatus } from '../api/health';
import { EventDetail } from '../components/EventDetail';
import { FeedList } from '../components/FeedList';
import { GuestPicker } from '../components/GuestPicker';
import { PersonaSwitcher } from '../components/PersonaSwitcher';
import { ScoresPanel, type InvestigateRequest } from '../components/ScoresPanel';
import { TickerFooter } from '../components/TickerFooter';
import { ReplayButton, ReplayStatus, SearchBox, TopBar } from '../components/TopBar';
import { useLiveDeps } from '../live/deps';
import { useLiveFeed } from '../live/useLiveFeed';
import { buildFeedView } from '../view/feed';
import { labelsFor, personaFrom, SWITCHER_LABELS } from '../view/personas';
import type { Viewer, ViewerKey } from '../view/types';

const IDLE: InvestigateRequest = { busy: false, error: null };

interface InvestigateState extends InvestigateRequest {
  viewerId: string;
  eventId: string;
}

// The visitor's last pick prefills the picker next time. A convenience only: the guest itself is
// the session cookie, and storage may be missing or blocked.
const LAST_PICK = 'kesher.guestPick';
function lastPick(): UniverseSymbol[] {
  try {
    const parsed = UniverseSymbol.array().safeParse(
      JSON.parse(localStorage.getItem(LAST_PICK) ?? '[]'),
    );
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}
function rememberPick(symbols: UniverseSymbol[]): void {
  try {
    localStorage.setItem(LAST_PICK, JSON.stringify(symbols));
  } catch {
    // Nothing to remember in.
  }
}

interface Props {
  // The viewer and the last scored event live above the routes, so they survive a visit to
  // another screen and a switch. viewer is null while the app checks for a guest cookie.
  viewer: Viewer | null;
  onViewerChange: (viewer: Viewer) => void;
  lastScoredEventId: string | null;
  onScored: (eventId: string) => void;
}

export function FeedScreen({ viewer, onViewerChange, lastScoredEventId, onScored }: Props) {
  const viewerKey: ViewerKey = viewer?.key ?? 'A';
  const viewerId = viewer ? `${viewer.key}:${viewer.session}` : '';
  const { api } = useLiveDeps();
  const [apiStatus, setApiStatus] = useState<ApiStatus>('checking');
  // The Replay control shows only where the api has the demo route (DEMO_MODE).
  const [demoMode, setDemoMode] = useState(false);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [replay, setReplay] = useState<{ busy: boolean; error: string | null }>({
    busy: false,
    error: null,
  });
  // Keyed by viewer and event, so a request on one card never shows on another.
  const [investigate, setInvestigate] = useState<InvestigateState>({
    ...IDLE,
    viewerId,
    eventId: '',
  });
  // The guest picker, open from the Your portfolio option.
  const [picker, setPicker] = useState<{ open: boolean; busy: boolean; error: string | null }>({
    open: false,
    busy: false,
    error: null,
  });
  const live = useLiveFeed(viewer, onScored);
  const guest = viewerKey === 'guest';

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
    const key = { viewerId, eventId };
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

  const onSwitch = (key: ViewerKey) => {
    if (key === 'guest') {
      setPicker({ open: true, busy: false, error: null });
      return;
    }
    onViewerChange({ key, session: 0 });
  };

  // A new guest, or new holdings for this guest; either way the feed loads again.
  const onPick = (symbols: UniverseSymbol[]) => {
    setPicker({ open: true, busy: true, error: null });
    rememberPick(symbols);
    const request = guest ? api.changeGuestPortfolio(symbols) : api.createGuest(symbols);
    request.then(
      () => {
        setPicker({ open: false, busy: false, error: null });
        setSelectedEventId(null);
        onViewerChange({ key: 'guest', session: (viewer?.session ?? 0) + 1 });
      },
      (error: unknown) =>
        setPicker({
          open: true,
          busy: false,
          error: error instanceof Error ? error.message : 'the portfolio could not be saved',
        }),
    );
  };

  // Until the api answers, the screen names the chosen persona with no holdings.
  const persona = (live.user && personaFrom(live.user)) ?? {
    ...labelsFor(viewerKey),
    _id: '',
    holdings: [],
  };
  const feed = buildFeedView(
    persona,
    { cards: live.cards, hidden: live.hidden, replayedEventId: lastScoredEventId },
    selectedEventId,
  );
  const replayed = [...feed.visible, ...feed.hidden].find((entry) => entry.replayed);

  let notice: string | null = null;
  if (live.status === 'signing_in') {
    notice = guest
      ? 'Loading your portfolio.'
      : `Signing in as ${labelsFor(viewerKey).displayName}.`;
  }
  if (live.status === 'error') {
    notice = 'Could not load the feed. Check that the api is running, then choose a persona again.';
  }

  const selected = notice ? null : feed.selected;

  // Desktop first: three panels from 1280px (xl). Below that they stack as feed, event, scores.
  return (
    <div className="flex min-h-screen flex-col xl:h-screen">
      <TopBar current="feed" start={<SearchBox />}>
        {replayed && <ReplayStatus at={replayed.event.publishedAt} />}
        {demoMode && !guest && (
          <div className="flex items-center gap-2">
            <ReplayButton busy={replay.busy} onReplay={onReplay} />
            {replay.error && (
              <span role="alert" className="max-w-[220px] text-xs text-text-2">
                {replay.error}
              </span>
            )}
          </div>
        )}
        <PersonaSwitcher personas={SWITCHER_LABELS} value={viewerKey} onChange={onSwitch} />
      </TopBar>
      <main className="flex flex-1 flex-col gap-3 p-3 xl:min-h-0 xl:flex-row">
        <FeedList
          persona={persona}
          visible={feed.visible}
          hidden={feed.hidden}
          hiddenTotal={feed.hiddenTotal}
          selectedEventId={feed.selected?.event._id ?? null}
          onSelect={setSelectedEventId}
          notice={notice}
          className="xl:w-[360px] xl:shrink-0"
        />
        <EventDetail
          view={selected}
          reaction={selected?.reaction ?? null}
          replayKey={viewerId}
          className="xl:min-w-0 xl:flex-1 xl:overflow-y-auto"
        />
        <ScoresPanel
          view={selected}
          investigate={
            selected &&
            investigate.eventId === selected.event._id &&
            investigate.viewerId === viewerId
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
      {picker.open && (
        <GuestPicker
          initial={
            guest && live.user ? live.user.holdings.map((holding) => holding.symbol) : lastPick()
          }
          changing={guest}
          busy={picker.busy}
          error={picker.error}
          onSubmit={onPick}
          onCancel={() => setPicker({ open: false, busy: false, error: null })}
        />
      )}
    </div>
  );
}
