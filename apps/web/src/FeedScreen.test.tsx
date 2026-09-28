import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';

const HEADLINE =
  'TSMC Suspends Chip Production After Taiwan Rocked By Strongest Tremor In 25 Years';

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

function relevanceScore(scores: HTMLElement) {
  return within(scores).getByTestId('relevance-value').textContent;
}

describe('feed screen, persona switcher', () => {
  it('starts as persona A and marks only that button pressed', () => {
    render(<App />);
    const switcher = screen.getByRole('group', { name: 'Viewing as' });
    const pressed = within(switcher)
      .getAllByRole('button')
      .filter((button) => button.getAttribute('aria-pressed') === 'true');
    expect(pressed.map((button) => button.textContent)).toEqual(['AI investor']);
  });

  it('A: relevance 0.80 through the TSMC to NVIDIA supplier path', () => {
    render(<App />);
    const { feed, event, scores } = regions();

    const row = within(feed).getByRole('button', { name: new RegExp(HEADLINE) });
    expect(within(row).getByText('High 0.80')).toBeTruthy();
    expect(
      within(row).getByRole('img', { name: 'TSMC supplies NVIDIA, which you hold' }),
    ).toBeTruthy();
    expect(within(feed).getByText('Events that connect to NVDA, MSFT and AMZN')).toBeTruthy();

    expect(within(event).getByRole('heading', { level: 2, name: HEADLINE })).toBeTruthy();
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
    expect(within(scores).getByRole('button', { name: 'Investigate this event' })).toBeTruthy();
  });

  it('B: relevance 1.00 because TSM is held directly', () => {
    render(<App />);
    pickPersona('Semiconductors');
    const { feed, event, scores } = regions();

    const row = within(feed).getByRole('button', { name: new RegExp(HEADLINE) });
    expect(within(row).getByText('High 1.00')).toBeTruthy();
    expect(within(row).getByRole('img', { name: 'You hold TSMC' })).toBeTruthy();
    expect(within(feed).getByText('Events that connect to AMD, AVGO, TSM and ASML')).toBeTruthy();

    expect(within(event).getByRole('img', { name: 'You hold TSMC directly' })).toBeTruthy();
    expect(within(event).queryByText('supplies')).toBeNull();

    expect(relevanceScore(scores)).toBe('1.00');
    expect(within(scores).getByText('High. You hold the company.')).toBeTruthy();
    expect(within(scores).getByText(/Direct holding\. No relationship is needed/)).toBeTruthy();
    expect(within(scores).queryByText(/We utilize foundries/)).toBeNull();
  });

  it('C: relevance 0.00, no path, and the event hidden from the feed', () => {
    render(<App />);
    pickPersona('Unrelated');
    const { feed, event, scores } = regions();

    expect(within(feed).getByText('0 events')).toBeTruthy();
    expect(within(feed).getByText('Nothing connects to your holdings yet')).toBeTruthy();
    expect(within(feed).getByText('Hidden for you')).toBeTruthy();
    const row = within(feed).getByRole('button', { name: new RegExp(HEADLINE) });
    expect(within(row).getByText('None 0.00')).toBeTruthy();
    expect(within(row).getByText('No path to your holdings')).toBeTruthy();

    expect(within(event).getByText('Why this stays out of your feed')).toBeTruthy();
    expect(
      within(event).getByRole('img', { name: 'No connection from TSMC to your holdings' }),
    ).toBeTruthy();

    expect(relevanceScore(scores)).toBe('0.00');
    expect(within(scores).getByText('None. No path to your holdings.')).toBeTruthy();
    expect(within(scores).queryByRole('button', { name: 'Investigate this event' })).toBeNull();
    expect(within(scores).getByText(/nothing to investigate for you/)).toBeTruthy();
  });

  it('keeps the event scores that do not depend on the investor', () => {
    render(<App />);
    for (const label of ['AI investor', 'Semiconductors', 'Unrelated']) {
      pickPersona(label);
      const { scores } = regions();
      expect(within(scores).getByText('4 of 5')).toBeTruthy();
      expect(within(scores).getByText('Medium')).toBeTruthy();
    }
  });

  it('replays the connection path when the persona changes', () => {
    render(<App />);
    const first = within(regions().event).getByRole('img', { name: /TSMC supplies NVIDIA/ });
    pickPersona('Semiconductors');
    pickPersona('AI investor');
    const again = within(regions().event).getByRole('img', { name: /TSMC supplies NVIDIA/ });
    expect(again).not.toBe(first);
  });

  it('marks the held symbol in the market table', () => {
    render(<App />);
    const table = within(regions().event).getByRole('table');
    expect(within(table).getByRole('rowheader', { name: 'NVDA, you hold' })).toBeTruthy();
    expect(within(table).getByRole('rowheader', { name: 'TSM' })).toBeTruthy();

    pickPersona('Semiconductors');
    const tableB = within(regions().event).getByRole('table');
    expect(within(tableB).getByRole('rowheader', { name: 'TSM, you hold' })).toBeTruthy();
    expect(within(tableB).getByRole('rowheader', { name: 'NVDA' })).toBeTruthy();
  });

  it('shows signed percentages with a true minus', () => {
    render(<App />);
    const table = within(regions().event).getByRole('table');
    expect(within(table).getAllByText('−1.16%').length).toBeGreaterThan(0);
    expect(within(table).getAllByText('+1.25%').length).toBeGreaterThan(0);
    expect(table.textContent).not.toMatch(/-\d/);

    const footer = screen.getByRole('contentinfo');
    expect(within(footer).getByText('−0.54%')).toBeTruthy();
    expect(footer.textContent).not.toMatch(/-\d/);
  });
});
