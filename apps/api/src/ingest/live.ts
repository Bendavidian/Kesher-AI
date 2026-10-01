import type { AlpacaNewsItem, EdgarFiling } from '@kesher/shared';
import type { Db } from 'mongodb';
import { describeError, describeErrorLine } from '../config/redact';
import { collection } from '../db/collections';
import type { ModelClient } from '../llm/client';
import { fetchAlpacaNewsRange, toIncomingItem, type AlpacaKeys } from './alpaca';
import { startAlpacaNews, type AlpacaNewsStream, type ConnectWebSocket } from './alpacaStream';
import { countDrop } from './counters';
import { toIncomingFiling, type FilerRef } from './edgar';
import { createEdgarPoller, type EdgarPoller } from './edgarPoller';
import { reserveLiveExtraction } from './extractionBudget';
import type { IncomingItem } from './item';
import { passesUniverse } from './prefilter';
import { findProcessed, processItem, type ProcessDeps } from './process';
import { createIngestQueue, type IngestQueue, type QueueOptions } from './queue';
import { externalIdOf, recordLive, type LiveItem } from './recordings';

export interface LiveIngestDeps {
  db: Db;
  models: () => ModelClient;
  // The local embedding model, for each event's vector at extraction, as on replay.
  embedder?: ProcessDeps['embedder'];
  onScored?: ProcessDeps['onScored'];
  log?: (message: string) => void;
  now?: () => Date;
  // Each source starts only when given. fetch reads the news history for the gap fill; the
  // timings are for tests.
  alpaca?: {
    keys: AlpacaKeys;
    connect?: ConnectWebSocket;
    fetch?: typeof globalThis.fetch;
    minBackoffMs?: number;
    idleMs?: number;
  };
  edgar?: { userAgent: string; fetch?: typeof globalThis.fetch; intervalMs?: number };
  queue?: QueueOptions;
}

export interface LiveIngest {
  handleNews(item: AlpacaNewsItem): Promise<void>;
  handleFiling(filing: EdgarFiling, company: FilerRef): Promise<void>;
  // Resolves when no gap fill runs and the queue has nothing running or waiting. For tests.
  idle(): Promise<void>;
  stop(): Promise<void>;
}

// The longest stretch a subscription fills from the news history: a reconnect, or the first
// subscription after a restart (SPEC.md decision log, T19). Older items stay missed, so a long
// outage or a first start never floods the queue and the day's extraction cap.
export const GAP_MAX_MS = 60 * 60_000;
// An item can reach the stream a little after its created_at, so the gap starts this much before
// the last message.
const GAP_OVERLAP_MS = 60_000;

// Live items enter the same pipeline as replay, in mode live (SPEC.md Pipeline). An item that
// fails the pre filter is counted by processItem right away, with no model call and no
// recording. One that passes is recorded first, without its article body, so it can be replayed
// later, then queued: the queue runs one item at a time, so the screen and the extraction never
// race the model limiter. The scored cards reach the sockets through onScored, as on replay.
export function startLiveIngest({
  db,
  models,
  embedder,
  onScored,
  log = console.log,
  now = () => new Date(),
  alpaca,
  edgar,
  queue: queueOptions,
}: LiveIngestDeps): LiveIngest {
  // A shed item stays recorded, so a replay can still process it (SPEC.md decision log, T19).
  const queue: IngestQueue = createIngestQueue({
    ...queueOptions,
    log,
    onShed: () => countDrop(db, 'queue_full', 'live', now()),
  });
  const deps: ProcessDeps = {
    mode: 'live',
    models,
    log,
    now,
    ...(embedder ? { embedder } : {}),
    ...(onScored ? { onScored } : {}),
  };
  // News takes one of the day's extractions; filings, a few a day and Tier 1, never wait on the
  // cap (SPEC.md decision log, T19). One reservation per item: a retry after a 429 runs the same
  // job again and keeps the extraction it reserved.
  const newsDeps = (): ProcessDeps => {
    let reserved = false;
    return {
      ...deps,
      reserveExtraction: async () =>
        (reserved ||= (await reserveLiveExtraction(db, now())).reserved),
    };
  };

  let stopped = false;
  // Stops a gap fill's history requests when live ingestion stops.
  const stopping = new AbortController();
  // Items this process accepted (recorded and queued), with when: the gap fill skips them, so an
  // item still queued, waiting for a retry, shed or capped is never handed over twice. Pruned to
  // the gap window. Empty after a restart, so an item accepted before it and never processed
  // comes again.
  const accepted = new Map<string, number>();

  async function accept(live: LiveItem, incoming: IncomingItem, itemDeps: ProcessDeps) {
    // After stop, no new item starts while the database closes.
    if (stopped) return;
    const key = `${live.provider} ${externalIdOf(live)}`;
    if (!passesUniverse(incoming.symbols)) {
      await processItem(db, incoming, itemDeps);
      return;
    }
    accepted.set(key, now().getTime());
    try {
      await recordLive(db, live, now());
    } catch (error) {
      log(`recording ${key} failed: ${describeError(error)}`);
    }
    queue.push(
      key,
      async () => {
        const result = await processItem(db, incoming, itemDeps);
        if (result.outcome === 'processed') log(`live ${key} processed, event ${result.eventId}`);
        else if (result.reason === 'daily_cap') log(`live ${key} is past today's extraction cap`);
      },
      { shedLast: live.provider === 'sec_edgar' },
    );
  }

  const handleNews = (item: AlpacaNewsItem) =>
    accept({ provider: 'alpaca', item }, toIncomingItem(item), newsDeps());
  const handleFiling = (filing: EdgarFiling, company: FilerRef) =>
    accept({ provider: 'sec_edgar', item: filing }, toIncomingFiling(filing, company), deps);

  // Where a gap starts: since, the stream's last message before it, or on the first subscription
  // of this process the newest Alpaca item any machine recorded. Never more than GAP_MAX_MS back;
  // null when nothing was ever recorded, as on a first start.
  async function gapStart(since: Date | null): Promise<Date | null> {
    let from = since;
    if (!from) {
      const [newest] = await collection(db, 'recordings')
        .find({ provider: 'alpaca' })
        .sort({ recordedAt: -1 })
        .limit(1)
        .toArray();
      if (!newest) return null;
      from = newest.recordedAt;
    }
    const floor = now().getTime() - GAP_MAX_MS;
    return new Date(Math.max(from.getTime() - GAP_OVERLAP_MS, floor));
  }

  // The news the stream missed, from the history, through the same path as streamed items. An
  // item this process accepted already, or one processed by any process, is skipped before it,
  // as the poller skips filings, so overlaps never inflate the duplicate counter or take a
  // second extraction. The queue merges one the stream delivers at the same time.
  async function fillGap(keys: AlpacaKeys, fetch: typeof globalThis.fetch, since: Date | null) {
    const start = await gapStart(since);
    if (!start || stopped) return;
    const end = now();
    for (const [key, at] of accepted) {
      if (at < start.getTime()) accepted.delete(key);
    }
    const companies = await collection(db, 'companies').find({}).toArray();
    // Without symbols the endpoint answers all news; an unseeded database has no universe.
    if (companies.length === 0) return;
    const range = await fetchAlpacaNewsRange({
      start,
      end,
      symbols: companies.map((company) => company.symbol),
      keys,
      fetch,
      signal: stopping.signal,
    });
    let handed = 0;
    for (const item of range.items) {
      if (stopped) return;
      const externalId = String(item.id);
      try {
        if (accepted.has(`alpaca ${externalId}`)) continue;
        if (await findProcessed(db, { provider: 'alpaca', externalId })) continue;
        handed += 1;
        await handleNews(item);
      } catch (error) {
        log(`alpaca gap item ${externalId} failed: ${describeErrorLine(error)}`);
      }
    }
    log(
      `alpaca gap ${start.toISOString()} to ${end.toISOString()}: ${range.items.length} items, ${handed} not processed yet` +
        (range.skipped ? `, ${range.skipped} failed their schema` : '') +
        (range.complete ? '' : '; the page limit cut it short'),
    );
  }

  // One gap fill at a time, in subscription order.
  let gap: Promise<void> = Promise.resolve();

  const stream: AlpacaNewsStream | null = alpaca
    ? startAlpacaNews({
        keys: alpaca.keys,
        log,
        now,
        ...(alpaca.connect ? { connect: alpaca.connect } : {}),
        ...(alpaca.minBackoffMs ? { minBackoffMs: alpaca.minBackoffMs } : {}),
        ...(alpaca.idleMs ? { idleMs: alpaca.idleMs } : {}),
        onItem: (item) => {
          handleNews(item).catch((error: unknown) =>
            log(`live alpaca ${item.id} failed: ${describeError(error)}`),
          );
        },
        onSubscribed: ({ since }) => {
          gap = gap
            .then(() => fillGap(alpaca.keys, alpaca.fetch ?? globalThis.fetch, since))
            .catch((error: unknown) => log(`alpaca gap fill failed: ${describeErrorLine(error)}`));
        },
      })
    : null;

  const poller: EdgarPoller | null = edgar
    ? createEdgarPoller({
        db,
        userAgent: edgar.userAgent,
        onFiling: handleFiling,
        log,
        now,
        ...(edgar.fetch ? { fetch: edgar.fetch } : {}),
        ...(edgar.intervalMs ? { intervalMs: edgar.intervalMs } : {}),
      })
    : null;
  poller?.start();

  return {
    handleNews,
    handleFiling,
    // The gap fill first: it hands its items to the queue.
    idle: async () => {
      await gap;
      await queue.idle();
    },
    async stop() {
      stopped = true;
      stream?.stop();
      stopping.abort();
      await gap;
      await poller?.stop();
      await queue.stop();
    },
  };
}
