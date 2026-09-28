import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';

function stubFetch(result: () => Promise<Response>) {
  const fetchMock = vi.fn(result);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('App frame', () => {
  it('renders the top bar, three panels in stacking order and the ticker footer', () => {
    stubFetch(() => Promise.resolve(Response.json({ status: 'ok' })));
    render(<App />);

    expect(within(screen.getByRole('banner')).getByText('Kesher')).toBeTruthy();

    const main = screen.getByRole('main');
    const feed = within(main).getByRole('region', { name: 'Your feed' });
    const event = within(main).getByRole('region', { name: 'Event' });
    const scores = within(main).getByRole('complementary', { name: 'Scores and evidence' });
    // Below 1280px the panels stack in DOM order: feed, event, scores (SPEC.md, Stack).
    expect(feed.compareDocumentPosition(event) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(event.compareDocumentPosition(scores) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    expect(screen.getByRole('contentinfo')).toBeTruthy();
  });

  it('shows API ok when /api/health returns a valid body', async () => {
    const fetchMock = stubFetch(() => Promise.resolve(Response.json({ status: 'ok' })));
    render(<App />);

    expect(await screen.findByText('API ok')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith('/api/health');
  });

  it('shows API unreachable when the request fails', async () => {
    stubFetch(() => Promise.reject(new TypeError('Failed to fetch')));
    render(<App />);

    expect(await screen.findByText('API unreachable')).toBeTruthy();
  });

  it('shows API unreachable on an error status', async () => {
    stubFetch(() => Promise.resolve(Response.json({ status: 'ok' }, { status: 500 })));
    render(<App />);

    expect(await screen.findByText('API unreachable')).toBeTruthy();
  });

  it('shows API unreachable on an invalid body', async () => {
    stubFetch(() => Promise.resolve(Response.json({ status: 'down' })));
    render(<App />);

    expect(await screen.findByText('API unreachable')).toBeTruthy();
  });
});
