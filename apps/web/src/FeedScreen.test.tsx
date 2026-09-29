import type { FeedCard, PersonaKey } from '@kesher/shared';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { DEMO_CARDS, DEMO_EXPLAINS, PUBLIC_USERS } from './fixtures';
import { DEMO_EVENT } from './fixtures/demoEvent';
import type { LiveDeps } from './live/deps';
import type { FeedSocketHandlers } from './live/socket';

const HEADLINE =
  'TSMC Suspends Chip Production After Taiwan Rocked By Strongest Tremor In 25 Years';

// A fake api and socket over the fixtures: the signed in persona decides every answer, like the
// session cookie does on the real api.
function fakeLive({ feeds = DEMO_CARDS }: { feeds?: Record<PersonaKey, FeedCard[]> } = {}) {
  let signedIn: PersonaKey = 'A';
  const sockets: { handlers: FeedSocketHandlers; closed: boolean }[] = [];
  const api = {
    signInAs: vi.fn((key: PersonaKey) => {
      signedIn = key;
      return Promise.resolve(PUBLIC_USERS[key]);
    }),
    feed: vi.fn(() => Promise.resolve(feeds[signedIn])),
    explain: vi.fn(() => Promise.resolve(DEMO_EXPLAINS[signedIn])),
    replayDemo: vi.fn(() =>
      Promise.resolve({
        outcome: 'processed' as const,
        sourceId: DEMO_EVENT.sourceIds[0]!,
        eventId: DEMO_EVENT._id,
        sourceCreated: false,
        eventCreated: false,
      }),
    ),
  };
  const deps: LiveDeps = {
    api,
    connectFeed: (handlers) => {
      const socket = { handlers, closed: false };
      sockets.push(socket);
      handlers.onConnection(true);
      return { close: () => (socket.closed = true) };
    },
  };
  // The open socket of the current session.
  const socket = () => sockets.filter((s) => !s.closed).at(-1)!.handlers;
  return { api, deps, socket, sockets };
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(Response.json({ status: 'ok' }))),
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

    expect(within(row(feed)).getByText('High 0.80')).toBeTruthy();
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
    expect(within(scores).getByText('High. Measured along the path.')).toBeTruthy();
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

  it('C: an empty feed until the event is scored, then None from explain', async () => {
    const { api, deps, socket } = fakeLive();
    render(<App deps={deps} />);
    await ready();
    pickPersona('Unrelated');
    await ready('Nothing connects to KO, JNJ and XOM');

    expect(within(regions().feed).getByText('0 events')).toBeTruthy();
    expect(within(regions().feed).queryByText('Hidden for you')).toBeNull();
    expect(api.explain).not.toHaveBeenCalled();

    act(() => socket().onScored(DEMO_EVENT._id));
    await screen.findByText('Hidden for you');
    const { feed, event, scores } = regions();

    expect(api.explain).toHaveBeenCalledWith(DEMO_EVENT._id);
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

  it('explains the last scored event after a switch to C in the same browser', async () => {
    const { api, deps, socket } = fakeLive();
    render(<App deps={deps} />);
    await ready();
    act(() => socket().onScored(DEMO_EVENT._id));

    pickPersona('Unrelated');
    await screen.findByText('Hidden for you');
    expect(api.explain).toHaveBeenLastCalledWith(DEMO_EVENT._id);
  });

  it('shows a pushed card, and closes the socket of the previous persona on a switch', async () => {
    const { deps, socket, sockets } = fakeLive({ feeds: { A: [], B: [], C: [] } });
    render(<App deps={deps} />);
    await ready('Nothing connects to NVDA, MSFT and AMZN');

    act(() => {
      socket().onCard(DEMO_CARDS.A[0]!);
      socket().onScored(DEMO_EVENT._id);
    });
    const feed = regions().feed;
    expect(within(row(feed)).getByText('High 0.80')).toBeTruthy();
    expect(within(row(feed)).getByText('Replayed now')).toBeTruthy();
    expect(screen.getByText('Replay')).toBeTruthy();

    pickPersona('Semiconductors');
    await ready('Nothing connects to AMD, AVGO, TSM and ASML');
    expect(sockets.map((s) => s.closed)).toEqual([true, false]);
  });

  it('keeps the event scores that do not depend on the investor', async () => {
    const { deps, socket } = fakeLive();
    render(<App deps={deps} />);
    await ready();
    act(() => socket().onScored(DEMO_EVENT._id));
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

  it('shows no price moves until the api sends a price reaction', async () => {
    render(<App deps={fakeLive().deps} />);
    await ready();
    const { event } = regions();
    expect(within(event).getByText(/No price reaction yet/)).toBeTruthy();
    expect(within(event).queryByRole('table')).toBeNull();
    expect(within(screen.getByRole('contentinfo')).getByText('No replayed session')).toBeTruthy();
  });

  it('keeps Investigate and View agent run disabled until research is wired', async () => {
    render(<App deps={fakeLive().deps} />);
    await ready();
    const { scores } = regions();
    for (const name of ['Investigate this event', 'View agent run']) {
      expect(within(scores).getByRole('button', { name }).hasAttribute('disabled')).toBe(true);
    }
  });

  it('Replay demo event resets and replays through the api', async () => {
    const { api, deps } = fakeLive();
    render(<App deps={deps} />);
    await ready();

    fireEvent.click(screen.getByRole('button', { name: 'Replay demo event' }));
    expect(api.replayDemo).toHaveBeenCalledOnce();
    await screen.findByRole('button', { name: 'Replay demo event' });
  });

  it('names the replay error', async () => {
    const { api, deps } = fakeLive();
    api.replayDemo.mockRejectedValueOnce(new Error('GROQ_API_KEY is not set'));
    render(<App deps={deps} />);
    await ready();

    fireEvent.click(screen.getByRole('button', { name: 'Replay demo event' }));
    expect((await screen.findByRole('alert')).textContent).toBe('GROQ_API_KEY is not set');
  });

  it('says so when the feed cannot load', async () => {
    const { api, deps } = fakeLive();
    api.signInAs.mockRejectedValue(new Error('offline'));
    render(<App deps={deps} />);

    expect(await screen.findByText(/Could not load the feed/)).toBeTruthy();
  });
});
