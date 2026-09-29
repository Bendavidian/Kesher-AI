import { AlpacaNewsItem } from '@kesher/shared';
import type { AlpacaKeys } from './alpaca';

// The Alpaca news WebSocket (docs/SPIKE.md check 3). The free plan allows one connection per
// account, so only the machine with LIVE_INGEST on opens it (SPEC.md Replay and recording).
export const ALPACA_NEWS_STREAM_URL = 'wss://stream.data.alpaca.markets/v1beta1/news';

// The part of a WebSocket the stream uses; tests pass a fake.
export interface WebSocketLike {
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onclose: ((event: unknown) => void) | null;
  send(data: string): void;
  close(): void;
}
export type ConnectWebSocket = (url: string) => WebSocketLike;

// Node's global WebSocket (Node 22 and later).
const connectGlobal: ConnectWebSocket = (url) => new WebSocket(url) as unknown as WebSocketLike;

// Errors that another try cannot fix: bad keys, a plan without news. The stream stops and says
// why.
const FATAL_CODES: Record<number, string> = {
  402: 'authentication failed; check the Alpaca keys',
  409: 'the Alpaca plan does not include news',
};

// The one connection is taken: by the other machine, or by this one's previous connection that
// Alpaca has not let go of yet after a drop. Retried with the usual wait, and said every time.
const CONNECTION_LIMIT = 406;

// Provider values in a log line: one line, short.
const forLog = (value: unknown) => String(value).replace(/\s+/g, ' ').slice(0, 40);

export interface AlpacaNewsOptions {
  keys: AlpacaKeys;
  // Called for each news item that passes AlpacaNewsItem, without content or images.
  onItem: (item: AlpacaNewsItem) => void;
  log?: (message: string) => void;
  connect?: ConnectWebSocket;
  url?: string;
  minBackoffMs?: number;
  maxBackoffMs?: number;
}

export interface AlpacaNewsStream {
  stop(): void;
}

// Connects, authenticates and subscribes to all news; the pre filter decides what passes, so the
// drops are counted (SPEC.md Pipeline). A dropped connection reconnects with a doubling wait from
// minBackoffMs to maxBackoffMs, reset once a subscription succeeds. Items published while the
// connection was down are not fetched again (BACKLOG.md T19).
export function startAlpacaNews({
  keys,
  onItem,
  log = console.log,
  connect = connectGlobal,
  url = ALPACA_NEWS_STREAM_URL,
  minBackoffMs = 5_000,
  maxBackoffMs = 5 * 60_000,
}: AlpacaNewsOptions): AlpacaNewsStream {
  let socket: WebSocketLike | null = null;
  let timer: NodeJS.Timeout | null = null;
  let backoff = minBackoffMs;
  let stopped = false;

  const halt = (reason: string) => {
    log(`alpaca news stream stopped: ${reason}`);
    stopped = true;
    socket?.close();
    socket = null;
  };

  const scheduleReconnect = () => {
    if (stopped || timer) return;
    log(`alpaca news stream reconnects in ${Math.round(backoff / 1000)} s`);
    timer = setTimeout(() => {
      timer = null;
      open();
    }, backoff);
    timer.unref();
    backoff = Math.min(backoff * 2, maxBackoffMs);
  };

  const handle = (message: Record<string, unknown>) => {
    switch (message.T) {
      case 'success':
        if (message.msg === 'connected') {
          socket?.send(JSON.stringify({ action: 'auth', key: keys.keyId, secret: keys.secretKey }));
        } else if (message.msg === 'authenticated') {
          socket?.send(JSON.stringify({ action: 'subscribe', news: ['*'] }));
        }
        return;
      case 'subscription':
        backoff = minBackoffMs;
        log('alpaca news stream subscribed');
        return;
      case 'error': {
        const code = typeof message.code === 'number' ? message.code : 0;
        const fatal = FATAL_CODES[code];
        if (fatal) {
          halt(`${code}, ${fatal}`);
        } else if (code === CONNECTION_LIMIT) {
          log(
            'alpaca news stream: connection limit exceeded; is LIVE_INGEST on for another machine? Retrying',
          );
          socket?.close();
        } else {
          log(`alpaca news stream error ${code}; reconnecting`);
          socket?.close();
        }
        return;
      }
      case 'n': {
        const item = AlpacaNewsItem.safeParse(message);
        if (item.success) onItem(item.data);
        else log(`alpaca news item ${forLog(message.id)} failed its schema; skipped`);
        return;
      }
    }
  };

  function open() {
    if (stopped) return;
    const current = connect(url);
    socket = current;
    current.onmessage = (event) => {
      let messages: unknown;
      try {
        messages = JSON.parse(String(event.data));
      } catch {
        log('alpaca news stream sent a message that is not JSON; skipped');
        return;
      }
      for (const message of Array.isArray(messages) ? messages : [messages]) {
        if (socket !== current) return;
        if (message && typeof message === 'object') handle(message as Record<string, unknown>);
      }
    };
    current.onerror = () => {
      // A close follows; reconnecting happens there.
    };
    current.onclose = () => {
      if (socket !== current) return;
      socket = null;
      scheduleReconnect();
    };
  }

  open();
  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
      const current = socket;
      socket = null;
      current?.close();
    },
  };
}
