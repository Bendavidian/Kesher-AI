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
  const start = () =>
    startAlpacaNews({
      keys,
      onItem: (item) => items.push(item),
      log: (message) => logs.push(message),
      connect,
      minBackoffMs: 1_000,
      maxBackoffMs: 4_000,
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
    vi.useFakeTimers();
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

  it('reconnects after a drop with a doubling wait, reset by a subscription', async () => {
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
    handshake(sockets[4]!);
    sockets[4]!.drop();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sockets).toHaveLength(6);
    stream.stop();
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

  it('never logs the keys', () => {
    const stream = start();
    handshake(sockets[0]!);
    sockets[0]!.receive({ T: 'error', code: 402, msg: 'auth failed' });
    stream.stop();
    expect(logs.join('\n')).not.toMatch(/key-id|secret-key/);
  });
});
