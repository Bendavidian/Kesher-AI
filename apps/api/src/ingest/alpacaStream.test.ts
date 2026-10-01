import type { AlpacaNewsItem } from '@kesher/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startAlpacaNews, type WebSocketLike } from './alpacaStream';

// A WebSocket double: the test plays the server by calling receive and drop.
class FakeSocket implements WebSocketLike {
  onmessage: WebSocketLike['onmessage'] = null;
  onerror: WebSocketLike['onerror'] = null;
  onclose: WebSocketLike['onclose'] = null;
  sent: unknown[] = [];
  closed = false;

  constructor(readonly url: string) {}

  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.onclose?.({});
  }
  receive(...messages: unknown[]) {
    this.onmessage?.({ data: JSON.stringify(messages) });
  }
  drop() {
    this.close();
  }
}

// A half open connection: close() never fires onclose, as when the network went away without a
// FIN. Only the stream's own timers can notice it.
class HalfOpenSocket extends FakeSocket {
  override close() {
    this.closed = true;
  }
}

const keys = { keyId: 'key-id', secretKey: 'secret-key' };

const news = {
  T: 'n',
  id: 41000001,
  headline: 'NVIDIA headline',
  summary: 'Summary.',
  author: 'Benzinga Newsdesk',
  created_at: '2026-09-29T13:30:00Z',
  updated_at: '2026-09-29T13:30:01Z',
  url: 'https://www.benzinga.com/news/26/09/41000001/x',
  content: '<p>The full article body.</p>',
  images: [],
  symbols: ['NVDA'],
  source: 'benzinga',
};

describe('startAlpacaNews', () => {
  let sockets: FakeSocket[];
  let items: AlpacaNewsItem[];
  let logs: string[];
  const connect = (url: string) => {
    const socket = new FakeSocket(url);
    sockets.push(socket);
    return socket;
  };
  let subscriptions: (Date | null)[];
  const start = (options: Partial<Parameters<typeof startAlpacaNews>[0]> = {}) =>
    startAlpacaNews({
      keys,
      onItem: (item) => items.push(item),
      onSubscribed: ({ since }) => subscriptions.push(since),
      log: (message) => logs.push(message),
      connect,
      minBackoffMs: 1_000,
      maxBackoffMs: 4_000,
      ...options,
    });
  // Plays the handshake: connected, authenticated, subscribed.
  const handshake = (socket: FakeSocket) => {
    socket.receive({ T: 'success', msg: 'connected' });
    socket.receive({ T: 'success', msg: 'authenticated' });
    socket.receive({ T: 'subscription', news: ['*'] });
  };

  beforeEach(() => {
    sockets = [];
    items = [];
    logs = [];
    subscriptions = [];
    vi.useFakeTimers({ now: new Date('2026-10-01T14:00:00Z') });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('authenticates after connected, then subscribes to all news', () => {
    const stream = start();
    const socket = sockets[0]!;
    expect(socket.url).toBe('wss://stream.data.alpaca.markets/v1beta1/news');
    handshake(socket);
    expect(socket.sent).toEqual([
      { action: 'auth', key: 'key-id', secret: 'secret-key' },
      { action: 'subscribe', news: ['*'] },
    ]);
    stream.stop();
  });

  it('hands over each news item without content, images or the stream type', () => {
    const stream = start();
    handshake(sockets[0]!);
    sockets[0]!.receive(news, { ...news, id: 'not a number' });
    expect(items).toEqual([
      {
        id: 41000001,
        headline: 'NVIDIA headline',
        summary: 'Summary.',
        author: 'Benzinga Newsdesk',
        created_at: '2026-09-29T13:30:00Z',
        updated_at: '2026-09-29T13:30:01Z',
        url: 'https://www.benzinga.com/news/26/09/41000001/x',
        symbols: ['NVDA'],
        source: 'benzinga',
      },
    ]);
    expect(logs).toContain('alpaca news item not a number failed its schema; skipped');
    stream.stop();
  });

  it('reconnects after a drop with a doubling wait, reset after a minute subscribed', async () => {
    const stream = start();
    handshake(sockets[0]!);
    sockets[0]!.drop();
    expect(sockets).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sockets).toHaveLength(2);
    sockets[1]!.drop();
    await vi.advanceTimersByTimeAsync(1_999);
    expect(sockets).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(sockets).toHaveLength(3);
    sockets[2]!.drop();
    await vi.advanceTimersByTimeAsync(4_000);
    expect(sockets).toHaveLength(4);
    sockets[3]!.drop();
    // Capped at maxBackoffMs.
    await vi.advanceTimersByTimeAsync(4_000);
    expect(sockets).toHaveLength(5);
    // Closed right after its subscription: the wait stays doubled.
    handshake(sockets[4]!);
    sockets[4]!.drop();
    await vi.advanceTimersByTimeAsync(3_999);
    expect(sockets).toHaveLength(5);
    await vi.advanceTimersByTimeAsync(1);
    expect(sockets).toHaveLength(6);
    // Subscribed for a minute: the next wait starts over.
    handshake(sockets[5]!);
    await vi.advanceTimersByTimeAsync(60_000);
    sockets[5]!.drop();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sockets).toHaveLength(7);
    stream.stop();
  });

  it('never throws when closing a socket throws', () => {
    const throwing = (url: string) => {
      const socket = connect(url);
      socket.close = () => {
        throw new Error('already closed');
      };
      return socket;
    };
    const stream = start({ connect: throwing });
    handshake(sockets[0]!);
    expect(() => sockets[0]!.receive({ T: 'error', code: 500, msg: 'x' })).not.toThrow();
    expect(() => stream.stop()).not.toThrow();
  });

  it('stops for good when the keys are refused', async () => {
    start();
    sockets[0]!.receive({ T: 'success', msg: 'connected' });
    sockets[0]!.receive({ T: 'error', code: 402, msg: 'auth failed' });
    expect(sockets[0]!.closed).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sockets).toHaveLength(1);
    expect(logs).toContain(
      'alpaca news stream stopped: 402, authentication failed; check the Alpaca keys',
    );
  });

  it('retries on connection limit exceeded, saying so each time', async () => {
    const stream = start();
    sockets[0]!.receive({ T: 'success', msg: 'connected' });
    sockets[0]!.receive({ T: 'error', code: 406, msg: 'connection limit exceeded' });
    expect(sockets[0]!.closed).toBe(true);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sockets).toHaveLength(2);
    expect(logs).toContain(
      'alpaca news stream: connection limit exceeded; is LIVE_INGEST on for another machine? Retrying',
    );
    stream.stop();
  });

  it('keeps a bad item id to one short line in the log', () => {
    const stream = start();
    sockets[0]!.receive({ ...news, id: `x\n${'y'.repeat(100)}` });
    expect(logs.at(-1)).toBe(`alpaca news item x ${'y'.repeat(38)} failed its schema; skipped`);
    stream.stop();
  });

  it('reconnects after an error that another try can fix', async () => {
    const stream = start();
    sockets[0]!.receive({ T: 'error', code: 404, msg: 'auth timeout' });
    expect(sockets[0]!.closed).toBe(true);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sockets).toHaveLength(2);
    stream.stop();
  });

  it('stop closes the socket and cancels a pending reconnect', async () => {
    const stream = start();
    sockets[0]!.drop();
    stream.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sockets).toHaveLength(1);

    const second = start();
    second.stop();
    expect(sockets[1]!.closed).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sockets).toHaveLength(2);
  });

  describe('silence and stalls (T19)', () => {
    const halfOpen = (url: string) => {
      const socket = new HalfOpenSocket(url);
      sockets.push(socket);
      return socket;
    };

    it('reconnects a half open socket that stays silent for 10 minutes', async () => {
      const stream = start({ connect: halfOpen });
      handshake(sockets[0]!);
      await vi.advanceTimersByTimeAsync(9 * 60_000);
      // Any message restarts the 10 minutes.
      sockets[0]!.receive(news);
      await vi.advanceTimersByTimeAsync(9 * 60_000);
      expect(sockets).toHaveLength(1);

      await vi.advanceTimersByTimeAsync(60_000);
      expect(sockets[0]!.closed).toBe(true);
      expect(logs).toContain('alpaca news stream silent for 10 min; reconnecting');
      await vi.advanceTimersByTimeAsync(1_000);
      expect(sockets).toHaveLength(2);
      handshake(sockets[1]!);

      // A close event the old socket sends late changes nothing.
      sockets[0]!.onclose?.({});
      await vi.advanceTimersByTimeAsync(60_000);
      expect(sockets).toHaveLength(2);
      stream.stop();
    });

    it('reconnects when no subscription arrives within 30 seconds', async () => {
      const stream = start({ connect: halfOpen });
      sockets[0]!.receive({ T: 'success', msg: 'connected' });
      await vi.advanceTimersByTimeAsync(29_999);
      expect(sockets[0]!.closed).toBe(false);

      await vi.advanceTimersByTimeAsync(1);
      expect(sockets[0]!.closed).toBe(true);
      expect(logs).toContain('alpaca news stream not subscribed within 30 s; reconnecting');
      await vi.advanceTimersByTimeAsync(1_000);
      expect(sockets).toHaveLength(2);
      stream.stop();
    });

    it('reconnects after an error even when the socket never reports its close', async () => {
      const stream = start({ connect: halfOpen });
      handshake(sockets[0]!);
      sockets[0]!.receive({ T: 'error', code: 500, msg: 'internal error' });
      await vi.advanceTimersByTimeAsync(1_000);
      expect(sockets).toHaveLength(2);
      stream.stop();
    });

    it('retries a connect that throws, instead of throwing', async () => {
      let attempts = 0;
      const flaky = (url: string) => {
        attempts += 1;
        if (attempts === 1) throw new SyntaxError('Invalid URL');
        return connect(url);
      };

      const stream = start({ connect: flaky });
      expect(logs).toContain('alpaca news stream could not connect: SyntaxError: Invalid URL');
      await vi.advanceTimersByTimeAsync(1_000);
      expect(sockets).toHaveLength(1);
      stream.stop();
    });

    it('reports its state, since when, and its last message', async () => {
      const stream = start();
      expect(stream.status()).toEqual({
        state: 'connecting',
        since: new Date('2026-10-01T14:00:00Z'),
        lastMessageAt: null,
      });

      await vi.advanceTimersByTimeAsync(2_000);
      handshake(sockets[0]!);
      expect(stream.status()).toEqual({
        state: 'subscribed',
        since: new Date('2026-10-01T14:00:02Z'),
        lastMessageAt: new Date('2026-10-01T14:00:02Z'),
      });

      sockets[0]!.drop();
      expect(stream.status()).toMatchObject({ state: 'reconnecting' });
      stream.stop();
      expect(stream.status()).toMatchObject({ state: 'stopped' });
    });

    it('tells each subscription when the stream was last live, null the first time', async () => {
      const stream = start();
      handshake(sockets[0]!);
      await vi.advanceTimersByTimeAsync(60_000);
      sockets[0]!.receive(news);
      sockets[0]!.drop();
      await vi.advanceTimersByTimeAsync(1_000);
      // A connection that never subscribes does not move the mark.
      sockets[1]!.receive({ T: 'success', msg: 'connected' });
      sockets[1]!.drop();
      await vi.advanceTimersByTimeAsync(2_000);
      handshake(sockets[2]!);

      expect(subscriptions).toEqual([null, new Date('2026-10-01T14:01:00Z')]);
      stream.stop();
    });
  });

  it('never logs the keys', () => {
    const stream = start();
    handshake(sockets[0]!);
    sockets[0]!.receive({ T: 'error', code: 402, msg: 'auth failed' });
    stream.stop();
    expect(logs.join('\n')).not.toMatch(/key-id|secret-key/);
  });
});
