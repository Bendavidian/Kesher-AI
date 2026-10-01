import { AlpacaNewsItem, type LiveStatus, type StreamState } from '@kesher/shared';
import { describeErrorLine } from '../config/redact';
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

// A subscribed connection with no message at all for this long is taken as dead: a half open
// socket never closes on its own (SPEC.md decision log, T19). News can be quiet for that long at
// night; reconnecting a healthy socket then costs one handshake, and the gap fill after the
// subscription finds nothing new.
export const IDLE_MS = 10 * 60_000;
// From opening a socket to its subscription.
export const HANDSHAKE_MS = 30_000;
// A connection subscribed this long was healthy, so the wait after it starts over; one a server
// closes right after its subscription keeps the doubled wait, and so does its gap fill.
export const STABLE_MS = 60_000;

// Already closed or never opened: whatever replaces it, a close that throws must not stop that.
function closeQuietly(socket: WebSocketLike) {
  try {
    socket.close();
  } catch {
    // Nothing to do: the socket is no longer current.
  }
}

export interface AlpacaNewsOptions {
  keys: AlpacaKeys;
  // Called for each news item that passes AlpacaNewsItem, without content or images.
  onItem: (item: AlpacaNewsItem) => void;
  // Called on each subscription with the time of the last message while subscribed before it:
  // the start of the gap the stream may have missed. null on the first subscription.
  onSubscribed?: (subscription: { since: Date | null }) => void;
  log?: (message: string) => void;
  now?: () => Date;
  connect?: ConnectWebSocket;
  url?: string;
  minBackoffMs?: number;
  maxBackoffMs?: number;
  idleMs?: number;
  handshakeMs?: number;
}

export interface AlpacaNewsStream {
  status(): NonNullable<LiveStatus['stream']>;
  stop(): void;
}

// Connects, authenticates and subscribes to all news; the pre filter decides what passes, so the
// drops are counted (SPEC.md Pipeline). A dropped connection reconnects with a doubling wait from
// minBackoffMs to maxBackoffMs, reset after a minute subscribed. Two timers catch a connection
// that stalls without closing: no subscription within handshakeMs, or no message for idleMs once
// subscribed. Items published while the connection was down are fetched by the caller from
// onSubscribed (live.ts, the gap fill).
export function startAlpacaNews({
  keys,
  onItem,
  onSubscribed,
  log = console.log,
  now = () => new Date(),
  connect = connectGlobal,
  url = ALPACA_NEWS_STREAM_URL,
  minBackoffMs = 5_000,
  maxBackoffMs = 5 * 60_000,
  idleMs = IDLE_MS,
  handshakeMs = HANDSHAKE_MS,
}: AlpacaNewsOptions): AlpacaNewsStream {
  let socket: WebSocketLike | null = null;
  let timer: NodeJS.Timeout | null = null;
  // The handshake timer until a subscription, then the idle timer.
  let watchdog: NodeJS.Timeout | null = null;
  let backoff = minBackoffMs;
  let stopped = false;
  let state: StreamState = 'connecting';
  let since = now();
  let lastMessageAt: Date | null = null;
  // The last message while subscribed: the end of what the stream is known to have delivered.
  let liveAt: Date | null = null;

  const enter = (next: StreamState) => {
    if (state === next) return;
    state = next;
    since = now();
  };

  const clearWatchdog = () => {
    if (watchdog) clearTimeout(watchdog);
    watchdog = null;
  };

  const arm = (ms: number, current: WebSocketLike, reason: string) => {
    clearWatchdog();
    watchdog = setTimeout(() => {
      watchdog = null;
      log(`alpaca news stream ${reason}; reconnecting`);
      drop(current);
    }, ms);
    watchdog.unref();
  };

  // Leaves a connection without waiting for its close event, which a stalled socket never sends.
  // The socket stops being current first, so a late close or message from it changes nothing.
  const drop = (current: WebSocketLike) => {
    if (socket !== current) return;
    socket = null;
    clearWatchdog();
    closeQuietly(current);
    scheduleReconnect();
  };

  const halt = (reason: string) => {
    log(`alpaca news stream stopped: ${reason}`);
    stopped = true;
    enter('stopped');
    clearWatchdog();
    const current = socket;
    socket = null;
    if (current) closeQuietly(current);
  };

  const scheduleReconnect = () => {
    if (stopped || timer) return;
    if (state === 'subscribed' && now().getTime() - since.getTime() >= STABLE_MS) {
      backoff = minBackoffMs;
    }
    enter('reconnecting');
    log(`alpaca news stream reconnects in ${Math.round(backoff / 1000)} s`);
    timer = setTimeout(() => {
      timer = null;
      open();
    }, backoff);
    timer.unref();
    backoff = Math.min(backoff * 2, maxBackoffMs);
  };

  const handle = (current: WebSocketLike, message: Record<string, unknown>) => {
    switch (message.T) {
      case 'success':
        if (message.msg === 'connected') {
          current.send(JSON.stringify({ action: 'auth', key: keys.keyId, secret: keys.secretKey }));
        } else if (message.msg === 'authenticated') {
          current.send(JSON.stringify({ action: 'subscribe', news: ['*'] }));
        }
        return;
      case 'subscription': {
        const gapStart = liveAt;
        enter('subscribed');
        liveAt = now();
        arm(idleMs, current, `silent for ${Math.round(idleMs / 60_000)} min`);
        log('alpaca news stream subscribed');
        onSubscribed?.({ since: gapStart });
        return;
      }
      case 'error': {
        const code = typeof message.code === 'number' ? message.code : 0;
        const fatal = FATAL_CODES[code];
        if (fatal) {
          halt(`${code}, ${fatal}`);
        } else if (code === CONNECTION_LIMIT) {
          log(
            'alpaca news stream: connection limit exceeded; is LIVE_INGEST on for another machine? Retrying',
          );
          drop(current);
        } else {
          log(`alpaca news stream error ${code}; reconnecting`);
          drop(current);
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
    let current: WebSocketLike;
    try {
      current = connect(url);
    } catch (error) {
      log(`alpaca news stream could not connect: ${describeErrorLine(error)}`);
      scheduleReconnect();
      return;
    }
    socket = current;
    enter('connecting');
    arm(handshakeMs, current, `not subscribed within ${Math.round(handshakeMs / 1000)} s`);
    current.onmessage = (event) => {
      if (socket !== current) return;
      lastMessageAt = now();
      if (state === 'subscribed') {
        liveAt = lastMessageAt;
        arm(idleMs, current, `silent for ${Math.round(idleMs / 60_000)} min`);
      }
      let messages: unknown;
      try {
        messages = JSON.parse(String(event.data));
      } catch {
        log('alpaca news stream sent a message that is not JSON; skipped');
        return;
      }
      for (const message of Array.isArray(messages) ? messages : [messages]) {
        if (socket !== current) return;
        if (message && typeof message === 'object') {
          handle(current, message as Record<string, unknown>);
        }
      }
    };
    current.onerror = () => {
      // A close follows; reconnecting happens there, or in a timer if it never comes.
    };
    current.onclose = () => {
      if (socket !== current) return;
      socket = null;
      clearWatchdog();
      scheduleReconnect();
    };
  }

  open();
  return {
    status: () => ({ state, since, lastMessageAt }),
    stop() {
      stopped = true;
      enter('stopped');
      clearWatchdog();
      if (timer) clearTimeout(timer);
      timer = null;
      const current = socket;
      socket = null;
      if (current) closeQuietly(current);
    },
  };
}
