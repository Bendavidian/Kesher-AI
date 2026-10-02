import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import type { PublicUser } from '@kesher/shared';
import { describe, expect, it } from 'vitest';
import type { KesherApi } from '../api/client';
import { LiveDepsContext, type LiveDeps } from '../live/deps';
import { useSession } from './context';
import { SessionProvider } from './SessionProvider';

const GUEST = {
  _id: '5b0f5a9e-8c1d-4f2a-9b3e-1a2b3c4d5e09',
  email: 'guest-5b0f5a9e-8c1d-4f2a-9b3e-1a2b3c4d5e09@guest.invalid',
  displayName: 'Your portfolio',
  holdings: [{ symbol: 'NVDA', quantity: 1 }],
  interests: [],
  expiresAt: new Date('2026-10-03T12:00:00Z'),
} as PublicUser;

function depsWith(me: () => Promise<PublicUser>): LiveDeps {
  return {
    api: { me } as unknown as KesherApi,
    connectFeed: () => ({ close: () => undefined }),
  };
}

function Probe() {
  const { viewer, lastScoredEventId } = useSession();
  return (
    <p>
      {viewer ? `${viewer.key}:${viewer.session}` : 'checking'} {lastScoredEventId ?? 'none'}
    </p>
  );
}

function renderSession(me: () => Promise<PublicUser>) {
  return renderHook(() => useSession(), {
    wrapper: ({ children }) => (
      <LiveDepsContext value={depsWith(me)}>
        <SessionProvider>{children}</SessionProvider>
      </LiveDepsContext>
    ),
  });
}

describe('useSession (T29)', () => {
  it('needs a SessionProvider', () => {
    expect(() => renderHook(() => useSession())).toThrow('useSession needs a SessionProvider');
  });

  it('starts as persona A when the cookie is not a guest', async () => {
    const { result } = renderSession(() => Promise.reject(new Error('sign in required')));
    expect(result.current.viewer).toBeNull();
    await waitFor(() => expect(result.current.viewer).toEqual({ key: 'A', session: 0 }));
  });

  it('keeps a guest across a reload', async () => {
    const { result } = renderSession(() => Promise.resolve(GUEST));
    await waitFor(() => expect(result.current.viewer).toEqual({ key: 'guest', session: 0 }));
  });

  it('keeps a viewer chosen before GET /me answers', async () => {
    let answer: (user: PublicUser) => void = () => undefined;
    const { result } = renderSession(() => new Promise((resolve) => (answer = resolve)));
    act(() => result.current.setViewer({ key: 'B', session: 0 }));
    await act(async () => {
      answer(GUEST);
      await Promise.resolve();
    });
    expect(result.current.viewer).toEqual({ key: 'B', session: 0 });
  });

  it('records the last scored event', async () => {
    const { result } = renderSession(() => Promise.reject(new Error('no')));
    act(() => result.current.onScored('7c1f7e66-0b1d-4a52-9d61-0d4e8b5b2a11'));
    expect(result.current.lastScoredEventId).toBe('7c1f7e66-0b1d-4a52-9d61-0d4e8b5b2a11');
    await waitFor(() => expect(result.current.viewer).not.toBeNull());
  });

  it('shares one session with every reader', async () => {
    render(
      <LiveDepsContext value={depsWith(() => Promise.reject(new Error('no')))}>
        <SessionProvider>
          <Probe />
          <Probe />
        </SessionProvider>
      </LiveDepsContext>,
    );
    expect(await screen.findAllByText('A:0 none')).toHaveLength(2);
  });
});
