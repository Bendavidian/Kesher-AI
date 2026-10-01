import {
  PriceReaction,
  type EventExplain,
  type FeedCard,
  type FeedResearch,
  type HiddenFeed,
  type IngestStatus,
  type PersonaKey,
} from '@kesher/shared';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import demoReaction from '../../../recordings/price-reactions/38062166.json';
import { App } from './App';
import { reviveDates } from './api/decode';
import { DEMO_CARDS, DEMO_EXPLAINS, PUBLIC_USERS } from './fixtures';
import { DEMO_EVENT } from './fixtures/demoEvent';
import type { LiveDeps } from './live/deps';
import type { FeedSocketHandlers } from './live/socket';

const RUN_ID = '00000000-0000-4000-8000-0000000000a1';
const REPORT_ID = '00000000-0000-4000-8000-0000000000a2';

// A's demo card with the given research state, as the api answers or pushes it.
const researched = (research: FeedResearch): FeedCard => {
  const card = DEMO_CARDS.A[0]!;
  return { ...card, item: { ...card.item, research } };
};

const HEADLINE =
  'TSMC Suspends Chip Production After Taiwan Rocked By Strongest Tremor In 25 Years';

const NONE_HIDDEN: HiddenFeed = { recent: [], total: 0 };

// A fake api and socket over the fixtures: the signed in persona decides every answer, like the
// session cookie does on the real api. hidden is what GET /feed/hidden answers per persona; a
// test changes it as scoring would.
// Live ingestion off on the api, with the day's counts from the shared database.
const INGEST_OFF: IngestStatus = {
  live: null,
  lastItemAt: new Date('2026-10-01T14:02:00Z'),
  today: {
    day: '2026-10-01',
    extractions: { used: 41, limit: 150 },
    counters: [{ reason: 'not_in_universe', count: 812 }],
  },
};

function fakeLive({
  feeds = DEMO_CARDS,
  ingest = INGEST_OFF,
}: { feeds?: Record<PersonaKey, FeedCard[]>; ingest?: IngestStatus } = {}) {
  let signedIn: PersonaKey = 'A';
  const hidden: Record<PersonaKey, HiddenFeed> = { A: NONE_HIDDEN, B: NONE_HIDDEN, C: NONE_HIDDEN };
  const sockets: { handlers: FeedSocketHandlers; closed: boolean }[] = [];
  const api = {
    signInAs: vi.fn((key: PersonaKey) => {
      signedIn = key;
      return Promise.resolve(PUBLIC_USERS[key]);
    }),
    me: vi.fn(() => Promise.resolve(PUBLIC_USERS[signedIn])),
    feed: vi.fn(() => Promise.resolve(feeds[signedIn])),
    hidden: vi.fn(() => Promise.resolve(hidden[signedIn])),
    investigate: vi.fn(() =>
      Promise.resolve(researched({ state: 'running', runId: RUN_ID, reportId: null })),
    ),
    report: vi.fn(() => Promise.reject(new Error('no report in this test'))),
    run: vi.fn(() => Promise.reject(new Error('no run in this test'))),
    runs: vi.fn(() => Promise.resolve([])),
    ingestStatus: vi.fn(() => Promise.resolve(ingest)),
    replayDemo: vi.fn(() =>
      Promise.resolve({
        reset: null,
        replay: {
          outcome: 'processed' as const,
          sourceId: DEMO_EVENT.sourceIds[0]!,
          eventId: DEMO_EVENT._id,
          sourceCreated: false,
          eventCreated: false,
        },
      }),
    ),
  };
  const deps: LiveDeps = {
    api,
    connectFeed: (handlers) => {
      const socket = { handlers, closed: false };
      sockets.push(socket);
      handlers.onConnection?.(true);
      return { close: () => (socket.closed = true) };
    },
  };
  // The open socket of the current session.
  const socket = () => sockets.filter((s) => !s.closed).at(-1)!.handlers;
  return { api, deps, socket, sockets, hidden };
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(Response.json({ status: 'ok', demoMode: true }))),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function regions() {
  const main = screen.getByRole('main');
  return {
    feed: within(main).getByRole('region', { name: 'Your feed' }),
    event: within(main).getByRole('region', { name: 'Event' }),
    scores: within(main).getByRole('complementary', { name: 'Scores and evidence' }),
  };
}

function pickPersona(label: string) {
  const switcher = screen.getByRole('group', { name: 'Viewing as' });
  fireEvent.click(within(switcher).getByRole('button', { name: label }));
}

// Waits for the signed in persona's feed to load.
async function ready(text: RegExp | string = /Events that connect to|Nothing connects to/) {
  await screen.findByText(text);
}

const row = (feed: HTMLElement) => within(feed).getByRole('button', { name: new RegExp(HEADLINE) });
const relevanceScore = (scores: HTMLElement) =>
  within(scores).getByTestId('relevance-value').textContent;

describe('feed screen, signed in through the persona switcher', () => {
  it('starts as persona A, signs in as A and marks only that button pressed', async () => {
    const { api, deps } = fakeLive();
    render(<App deps={deps} />);
    await ready();

    expect(api.signInAs).toHaveBeenCalledWith('A');
    const switcher = screen.getByRole('group', { name: 'Viewing as' });
    const pressed = within(switcher)
      .getAllByRole('button')
      .filter((button) => button.getAttribute('aria-pressed') === 'true');
    expect(pressed.map((button) => button.textContent)).toEqual(['AI investor']);
  });

  it('A: relevance 0.80 through the TSMC to NVIDIA supplier path', async () => {
    render(<App deps={fakeLive().deps} />);
    await ready();
    const { feed, event, scores } = regions();

    expect(within(row(feed)).getByText('Medium 0.80')).toBeTruthy();
    expect(
      within(row(feed)).getByRole('img', { name: 'TSMC supplies NVIDIA, which you hold' }),
    ).toBeTruthy();
    expect(within(feed).getByText('Events that connect to NVDA, MSFT and AMZN')).toBeTruthy();

    expect(within(event).getByRole('heading', { level: 2, name: HEADLINE })).toBeTruthy();
    expect(within(event).getByText('Benzinga via Alpaca')).toBeTruthy();
    expect(within(event).getByText('Why this reached you')).toBeTruthy();
    expect(
      within(event).getByRole('img', {
        name: 'TSMC supplies NVIDIA, and NVIDIA is in your portfolio',
      }),
    ).toBeTruthy();
    expect(
      within(event).getByText(/Edge evidence from the NVIDIA 10-K, filed Feb 25, 2026/),
    ).toBeTruthy();

    expect(relevanceScore(scores)).toBe('0.80');
    expect(within(scores).getByText('Medium. Measured along the path.')).toBeTruthy();
    expect(
      within(scores).getByText(/We utilize foundries, such as Taiwan Semiconductor/),
    ).toBeTruthy();
    expect(within(scores).getByText('Tier 1 primary')).toBeTruthy();
    expect(within(scores).getByText('Reviewed')).toBeTruthy();
  });

  it('B: relevance 1.00 because TSM is held directly', async () => {
    const { api, deps } = fakeLive();
    render(<App deps={deps} />);
    await ready();
    pickPersona('Semiconductors');
    await ready('Events that connect to AMD, AVGO, TSM and ASML');
    const { feed, event, scores } = regions();

    expect(api.signInAs).toHaveBeenLastCalledWith('B');
    expect(within(row(feed)).getByText('High 1.00')).toBeTruthy();
    expect(within(row(feed)).getByRole('img', { name: 'You hold TSMC' })).toBeTruthy();
    expect(within(event).getByRole('img', { name: 'You hold TSMC directly' })).toBeTruthy();

    expect(relevanceScore(scores)).toBe('1.00');
    expect(within(scores).getByText('High. You hold the company.')).toBeTruthy();
    expect(within(scores).getByText(/Direct holding\. No relationship is needed/)).toBeTruthy();
    expect(within(scores).queryByText(/We utilize foundries/)).toBeNull();
  });

  it('C: an empty feed until the event is scored, then None from the hidden items', async () => {
    const { api, deps, socket, hidden } = fakeLive();
    render(<App deps={deps} />);
    await ready();
    pickPersona('Unrelated');
    await ready('Nothing connects to KO, JNJ and XOM');

    expect(within(regions().feed).getByText('0 events')).toBeTruthy();
    expect(within(regions().feed).queryByText('Hidden for you')).toBeNull();
    const reads = api.hidden.mock.calls.length;

    hidden.C = { recent: [DEMO_EXPLAINS.C], total: 1 };
    act(() => socket().onScored!(DEMO_EVENT._id));
    await screen.findByText('Hidden for you');
    const { feed, event, scores } = regions();

    expect(api.hidden).toHaveBeenCalledTimes(reads + 1);
    expect(within(feed).queryByText(/more events? with no path/)).toBeNull();
    expect(within(row(feed)).getByText('None 0.00')).toBeTruthy();
    expect(within(row(feed)).getByText('No path to your holdings')).toBeTruthy();
    expect(within(row(feed)).getByText('Replayed now')).toBeTruthy();
    expect(within(event).getByText('Why this stays out of your feed')).toBeTruthy();
    expect(
      within(event).getByRole('img', { name: 'No connection from TSMC to your holdings' }),
    ).toBeTruthy();
    expect(relevanceScore(scores)).toBe('0.00');
    expect(within(scores).getByText('None. No path to your holdings.')).toBeTruthy();
    expect(within(scores).queryByRole('button', { name: 'Investigate this event' })).toBeNull();
    expect(within(scores).getByText(/nothing to investigate for you/)).toBeTruthy();
  });

  it('shows the last scored event as hidden after a switch to C in the same browser', async () => {
    const { deps, socket, hidden } = fakeLive();
    render(<App deps={deps} />);
    await ready();
    hidden.C = { recent: [DEMO_EXPLAINS.C], total: 1 };
    act(() => socket().onScored!(DEMO_EVENT._id));

    pickPersona('Unrelated');
    await screen.findByText('Hidden for you');
    expect(within(row(regions().feed)).getByText('Replayed now')).toBeTruthy();
  });

  it('shows the three most recent hidden events and counts the rest', async () => {
    const { deps, hidden } = fakeLive();
    const hiddenItem = (n: number, headline: string): EventExplain => ({
      ...DEMO_EXPLAINS.C,
      event: {
        ...DEMO_EXPLAINS.C.event,
        _id: `00000000-0000-4000-8000-0000000000c${n}`,
        headline,
      },
    });
    hidden.C = {
      recent: [
        hiddenItem(1, 'Newest hidden'),
        hiddenItem(2, 'Second hidden'),
        hiddenItem(3, 'Third hidden'),
      ],
      total: 25,
    };
    render(<App deps={deps} />);
    await ready();
    pickPersona('Unrelated');
    await screen.findByText('Hidden for you');
    const { feed } = regions();

    const text = feed.textContent ?? '';
    const at = ['Newest hidden', 'Second hidden', 'Third hidden'].map((h) => text.indexOf(h));
    expect(at.every((index) => index >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(within(feed).getByText('22 more events with no path to your holdings')).toBeTruthy();
    expect(within(feed).getByText(/^25 events had no path to KO, JNJ or XOM/)).toBeTruthy();
  });

  it('shows a pushed card, and closes the socket of the previous persona on a switch', async () => {
    const { deps, socket, sockets } = fakeLive({ feeds: { A: [], B: [], C: [] } });
    render(<App deps={deps} />);
    await ready('Nothing connects to NVDA, MSFT and AMZN');

    act(() => {
      socket().onCard!(DEMO_CARDS.A[0]!);
      socket().onScored!(DEMO_EVENT._id);
    });
    const feed = regions().feed;
    expect(within(row(feed)).getByText('Medium 0.80')).toBeTruthy();
    expect(within(row(feed)).getByText('Replayed now')).toBeTruthy();
    expect(screen.getByText('Replay')).toBeTruthy();

    pickPersona('Semiconductors');
    await ready('Nothing connects to AMD, AVGO, TSM and ASML');
    expect(sockets.map((s) => s.closed)).toEqual([true, false]);
  });

  it('keeps the event scores that do not depend on the investor', async () => {
    const { deps, socket, hidden } = fakeLive();
    render(<App deps={deps} />);
    await ready();
    hidden.C = { recent: [DEMO_EXPLAINS.C], total: 1 };
    act(() => socket().onScored!(DEMO_EVENT._id));
    for (const label of ['AI investor', 'Semiconductors', 'Unrelated']) {
      pickPersona(label);
      await screen.findByTestId('relevance-value');
      const { scores } = regions();
      expect(within(scores).getByText('4 of 5')).toBeTruthy();
      expect(within(scores).getByText('Medium')).toBeTruthy();
    }
  });

  it('replays the connection path when the persona changes', async () => {
    render(<App deps={fakeLive().deps} />);
    await ready();
    const first = within(regions().event).getByRole('img', { name: /TSMC supplies NVIDIA/ });
    pickPersona('Semiconductors');
    await ready('Events that connect to AMD, AVGO, TSM and ASML');
    pickPersona('AI investor');
    await ready('Events that connect to NVDA, MSFT and AMZN');
    const again = within(regions().event).getByRole('img', { name: /TSMC supplies NVIDIA/ });
    expect(again).not.toBe(first);
  });

  it('shows the price reaction the api sent, next to the benchmarks, and the closing moves', async () => {
    // The committed reaction of the demo event, as the api computes it for persona A's card.
    const reaction = PriceReaction.parse(reviveDates(demoReaction.reaction));
    const feeds = {
      ...DEMO_CARDS,
      A: DEMO_CARDS.A.map((card) => ({ ...card, priceReaction: reaction })),
    };
    render(<App deps={fakeLive({ feeds }).deps} />);
    await ready();
    const { event } = regions();
    const table = within(event).getByRole('table');
    expect(within(table).getByRole('rowheader', { name: 'NVDA, you hold' })).toBeTruthy();
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent),
    ).toEqual(['Symbol', 'Open gap', '15 min after open', '2 h after open', 'Session close']);
    expect(within(table).getByText('−1.16%')).toBeTruthy();
    expect(within(event).getByText(/previous regular close/)).toBeTruthy();
    expect(
      within(event).getByText(
        'NVDA opened −1.07% from its previous close; SMH −1.00%, SPY −0.22% in the same window.',
      ),
    ).toBeTruthy();
    expect(event.textContent).not.toMatch(/caused/i);
    const footer = screen.getByRole('contentinfo');
    expect(within(footer).getByText('−0.54%')).toBeTruthy();
    expect(within(footer).getByText('SIP data, delayed 15 minutes')).toBeTruthy();
  });

  it('shows no price moves when the api sent no price reaction', async () => {
    render(<App deps={fakeLive().deps} />);
    await ready();
    const { event } = regions();
    expect(within(event).getByText(/No price reaction for this event/)).toBeTruthy();
    expect(within(event).queryByRole('table')).toBeNull();
    expect(within(screen.getByRole('contentinfo')).getByText('No replayed session')).toBeTruthy();
  });

  it('starts research from Investigate and links the card to its report when done', async () => {
    const { api, deps, socket } = fakeLive();
    render(<App deps={deps} />);
    await ready();
    const { scores } = regions();

    fireEvent.click(within(scores).getByRole('button', { name: 'Investigate this event' }));
    expect(api.investigate).toHaveBeenCalledWith(DEMO_EVENT._id);
    const running = await within(scores).findByRole('button', { name: 'Investigating…' });
    expect(running.hasAttribute('disabled')).toBe(true);
    expect(within(scores).getByText(/Researching this event/)).toBeTruthy();
    // The run can be watched while it goes: the card names it from the start.
    expect(within(scores).getByRole('link', { name: 'View agent run' }).getAttribute('href')).toBe(
      `/runs/${RUN_ID}`,
    );

    act(() => socket().onCard!(researched({ state: 'done', runId: RUN_ID, reportId: REPORT_ID })));
    const link = await within(scores).findByRole('link', { name: 'Open research report' });
    expect(link.getAttribute('href')).toBe(`/reports/${REPORT_ID}`);
    const again = within(scores).getByRole('button', { name: 'Investigate again' });
    expect(again.hasAttribute('disabled')).toBe(false);
    expect(within(scores).getByRole('link', { name: 'View agent run' }).getAttribute('href')).toBe(
      `/runs/${RUN_ID}`,
    );
  });

  it('keeps View agent run disabled until the card names a run', async () => {
    render(<App deps={fakeLive().deps} />);
    await ready();
    const { scores } = regions();
    expect(
      within(scores).getByRole('button', { name: 'View agent run' }).hasAttribute('disabled'),
    ).toBe(true);
  });

  it('says when research ended without a report, and lets the user try again', async () => {
    const { deps, socket } = fakeLive();
    render(<App deps={deps} />);
    await ready();
    act(() => socket().onCard!(researched({ state: 'failed', runId: RUN_ID, reportId: null })));
    const { scores } = regions();
    expect(await within(scores).findByText(/ended without a report/)).toBeTruthy();
    const button = within(scores).getByRole('button', { name: 'Investigate this event' });
    expect(button.hasAttribute('disabled')).toBe(false);
    expect(within(scores).queryByRole('link', { name: 'Open research report' })).toBeNull();
  });

  it('names the error when research cannot start', async () => {
    const { api, deps } = fakeLive();
    api.investigate.mockRejectedValueOnce(new Error('research on this event is already running'));
    render(<App deps={deps} />);
    await ready();
    const { scores } = regions();
    fireEvent.click(within(scores).getByRole('button', { name: 'Investigate this event' }));
    expect((await within(scores).findByRole('alert')).textContent).toBe(
      'research on this event is already running',
    );
    expect(
      within(scores)
        .getByRole('button', { name: 'Investigate this event' })
        .hasAttribute('disabled'),
    ).toBe(false);
  });

  it('drops a research answer that arrives after a persona switch', async () => {
    const { api, deps } = fakeLive();
    let answer!: (card: FeedCard) => void;
    api.investigate.mockReturnValueOnce(new Promise<FeedCard>((resolve) => (answer = resolve)));
    render(<App deps={deps} />);
    await ready();
    fireEvent.click(
      within(regions().scores).getByRole('button', { name: 'Investigate this event' }),
    );
    pickPersona('Semiconductors');
    await ready('Events that connect to AMD, AVGO, TSM and ASML');
    act(() => answer(researched({ state: 'running', runId: RUN_ID, reportId: null })));
    await act(() => Promise.resolve());
    const { scores } = regions();
    expect(within(scores).queryByText(/Researching this event/)).toBeNull();
    expect(
      within(scores)
        .getByRole('button', { name: 'Investigate this event' })
        .hasAttribute('disabled'),
    ).toBe(false);
  });

  it('Replay demo event resets and replays through the api in demo mode', async () => {
    const { api, deps } = fakeLive();
    render(<App deps={deps} />);
    await ready();

    fireEvent.click(await screen.findByRole('button', { name: 'Replay demo event' }));
    expect(api.replayDemo).toHaveBeenCalledOnce();
    await screen.findByRole('button', { name: 'Replay demo event' });
  });

  it('hides Replay demo event when the api is not in demo mode', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(Response.json({ status: 'ok', demoMode: false }))),
    );
    const { deps } = fakeLive();
    render(<App deps={deps} />);
    await ready();

    await screen.findByText('API ok');
    expect(screen.queryByRole('button', { name: 'Replay demo event' })).toBeNull();
  });

  it('names the replay error', async () => {
    const { api, deps } = fakeLive();
    api.replayDemo.mockRejectedValueOnce(new Error('GROQ_API_KEY is not set'));
    render(<App deps={deps} />);
    await ready();

    fireEvent.click(await screen.findByRole('button', { name: 'Replay demo event' }));
    expect((await screen.findByRole('alert')).textContent).toBe('GROQ_API_KEY is not set');
  });

  it('shows live ingestion in the footer once signed in, with the day in its details', async () => {
    render(<App deps={fakeLive().deps} />);
    await ready();
    const footer = screen.getByRole('contentinfo');
    const summary = await within(footer).findByText('Live ingest off · last item Oct 1, 10:02 ET');

    fireEvent.click(summary);
    const details = summary.closest('details')!;
    expect(details.open).toBe(true);
    expect(within(details).getByText('Live ingestion today')).toBeTruthy();
    expect(within(details).getByText('41 of 150')).toBeTruthy();
    expect(within(details).getByText('Outside the universe')).toBeTruthy();
    expect(within(details).getByText('812')).toBeTruthy();
  });

  it('reads live ingestion again every minute and keeps the last answer on a failure', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { api, deps } = fakeLive();
      render(<App deps={deps} />);
      await ready();
      await screen.findByText(/^Live ingest off/);
      const reads = api.ingestStatus.mock.calls.length;
      api.ingestStatus.mockResolvedValueOnce({
        ...INGEST_OFF,
        live: {
          stream: { state: 'reconnecting', since: new Date(), lastMessageAt: null },
          edgar: null,
          queue: { waiting: 0, running: false, limit: 50 },
        },
      });

      await act(() => vi.advanceTimersByTimeAsync(60_000));
      expect(api.ingestStatus.mock.calls.length).toBe(reads + 1);
      expect(await screen.findByText(/^Live · reconnecting · last item/)).toBeTruthy();

      api.ingestStatus.mockRejectedValueOnce(new Error('offline'));
      await act(() => vi.advanceTimersByTimeAsync(60_000));
      expect(screen.getByText(/^Live · reconnecting/)).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('says so when the feed cannot load', async () => {
    const { api, deps } = fakeLive();
    api.signInAs.mockRejectedValue(new Error('offline'));
    render(<App deps={deps} />);

    expect(await screen.findByText(/Could not load the feed/)).toBeTruthy();
  });
});
