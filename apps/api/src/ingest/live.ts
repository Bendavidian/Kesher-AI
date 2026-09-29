import type { AlpacaNewsItem, EdgarFiling } from '@kesher/shared';
import type { Db } from 'mongodb';
import { describeError } from '../config/redact';
import type { ModelClient } from '../llm/client';
import { toIncomingItem, type AlpacaKeys } from './alpaca';
import { startAlpacaNews, type AlpacaNewsStream, type ConnectWebSocket } from './alpacaStream';
import { toIncomingFiling, type FilerRef } from './edgar';
import { createEdgarPoller, type EdgarPoller } from './edgarPoller';
import type { IncomingItem } from './item';
import { passesUniverse } from './prefilter';
import { processItem, type ProcessDeps } from './process';
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
  // Each source starts only when given.
  alpaca?: { keys: AlpacaKeys; connect?: ConnectWebSocket };
  edgar?: { userAgent: string; fetch?: typeof globalThis.fetch; intervalMs?: number };
  queue?: QueueOptions;
}

export interface LiveIngest {
  handleNews(item: AlpacaNewsItem): Promise<void>;
  handleFiling(filing: EdgarFiling, company: FilerRef): Promise<void>;
  // Resolves when the queue has nothing running or waiting. For tests.
  idle(): Promise<void>;
  stop(): Promise<void>;
}

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
  const queue: IngestQueue = createIngestQueue({ log, ...queueOptions });
  const deps: ProcessDeps = {
    mode: 'live',
    models,
    log,
    now,
    ...(embedder ? { embedder } : {}),
    ...(onScored ? { onScored } : {}),
  };

  let stopped = false;

  async function accept(live: LiveItem, incoming: IncomingItem): Promise<void> {
    // After stop, no new item starts while the database closes.
    if (stopped) return;
    const key = `${live.provider} ${externalIdOf(live)}`;
    if (!passesUniverse(incoming.symbols)) {
      await processItem(db, incoming, deps);
      return;
    }
    try {
      await recordLive(db, live, now());
    } catch (error) {
      log(`recording ${key} failed: ${describeError(error)}`);
    }
    queue.push(key, async () => {
      const result = await processItem(db, incoming, deps);
      if (result.outcome === 'processed') log(`live ${key} processed, event ${result.eventId}`);
    });
  }

  const handleNews = (item: AlpacaNewsItem) =>
    accept({ provider: 'alpaca', item }, toIncomingItem(item));
  const handleFiling = (filing: EdgarFiling, company: FilerRef) =>
    accept({ provider: 'sec_edgar', item: filing }, toIncomingFiling(filing, company));

  const stream: AlpacaNewsStream | null = alpaca
    ? startAlpacaNews({
        keys: alpaca.keys,
        log,
        ...(alpaca.connect ? { connect: alpaca.connect } : {}),
        onItem: (item) => {
          handleNews(item).catch((error: unknown) =>
            log(`live alpaca ${item.id} failed: ${describeError(error)}`),
          );
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
    idle: () => queue.idle(),
    async stop() {
      stopped = true;
      stream?.stop();
      await poller?.stop();
      await queue.stop();
    },
  };
}
