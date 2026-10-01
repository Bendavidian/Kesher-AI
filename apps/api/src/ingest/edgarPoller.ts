import { Company, type EdgarFiling, type LiveStatus } from '@kesher/shared';
import type { Db } from 'mongodb';
import { describeError, describeErrorLine } from '../config/redact';
import { collection } from '../db/collections';
import { SecHttpError } from '../sec/fetch';
import { fetchRecentFilings, type FilerRef } from './edgar';
import { findProcessed } from './process';

export interface EdgarPollerOptions {
  db: Db;
  userAgent: string;
  // Gets each filing once per process, new to the database.
  onFiling: (filing: EdgarFiling, company: FilerRef) => Promise<void> | void;
  log?: (message: string) => void;
  fetch?: typeof globalThis.fetch;
  now?: () => Date;
  intervalMs?: number;
  // How far back a poll looks, so a restart picks up what it missed within the window.
  lookbackMs?: number;
  // Between two requests to EDGAR, well under its 10 requests per second.
  gapMs?: number;
}

export interface EdgarPoller {
  // One pass over every universe filer. Exposed for tests; start runs it on a timer.
  poll(): Promise<void>;
  start(): void;
  status(): NonNullable<LiveStatus['edgar']>;
  stop(): Promise<void>;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// EDGAR's answers to a client it wants to slow down: 403 once fair access is exceeded, 429 for
// too many requests. Every company would get the same, so the whole poller pauses, doubling from
// 10 minutes to an hour, and a clean poll resets it (SPEC.md decision log, T19).
const SLOW_DOWN = new Set([403, 429]);
const PAUSE_MIN_MS = 10 * 60_000;
const PAUSE_MAX_MS = 60 * 60_000;

// Polls the EDGAR submissions of every universe company (SPEC.md Pipeline, the EDGAR poller).
// A filing is handed over once per process: the poller remembers what it saw, and a filing
// already processed (extracted and scored) is skipped without reaching processItem, so repeated
// polls and restarts never inflate the duplicate counter. A filing stored but not processed, for
// example after a daily quota, is handed over again after a restart and resumes.
export function createEdgarPoller({
  db,
  userAgent,
  onFiling,
  log = console.log,
  fetch = globalThis.fetch,
  now = () => new Date(),
  intervalMs = 5 * 60_000,
  lookbackMs = 24 * 3_600_000,
  gapMs = 150,
}: EdgarPollerOptions): EdgarPoller {
  // Accession number to acceptance time, pruned to the lookback window.
  const seen = new Map<string, number>();
  let timer: NodeJS.Timeout | null = null;
  let current: Promise<void> | null = null;
  let stopped = false;
  let pausedUntil: number | null = null;
  let nextPauseMs = PAUSE_MIN_MS;
  let lastPollAt: Date | null = null;

  async function poll(): Promise<void> {
    if (pausedUntil !== null && now().getTime() < pausedUntil) return;
    const since = new Date(now().getTime() - lookbackMs);
    for (const [accession, acceptedAt] of seen) {
      if (acceptedAt < since.getTime()) seen.delete(accession);
    }
    const companies = (
      await collection(db, 'companies').find({}).sort({ symbol: 1 }).toArray()
    ).map((doc) => Company.parse(doc));
    // Companies whose request failed, and the first failure: one line per poll, not per company.
    const failed: string[] = [];
    let firstFailure = '';
    for (const [index, company] of companies.entries()) {
      if (stopped) return;
      if (index > 0) await sleep(gapMs);
      let filings: EdgarFiling[];
      try {
        filings = await fetchRecentFilings(company.cik, since, { userAgent, fetch });
      } catch (error) {
        if (error instanceof SecHttpError && SLOW_DOWN.has(error.status)) {
          pausedUntil = now().getTime() + nextPauseMs;
          log(
            `edgar answered ${error.status}; every poll pauses for ${Math.round(nextPauseMs / 60_000)} min`,
          );
          nextPauseMs = Math.min(nextPauseMs * 2, PAUSE_MAX_MS);
          return;
        }
        if (failed.length === 0) firstFailure = describeErrorLine(error);
        failed.push(company.symbol);
        continue;
      }
      for (const filing of filings) {
        if (seen.has(filing.accessionNumber)) continue;
        const acceptedAt = new Date(filing.acceptanceDateTime).getTime();
        const processed = await findProcessed(db, {
          provider: 'sec_edgar',
          externalId: filing.accessionNumber,
        });
        if (!processed) {
          try {
            await onFiling(filing, company);
          } catch (error) {
            log(`edgar filing ${filing.accessionNumber} failed: ${describeError(error)}`);
            continue;
          }
        }
        seen.set(filing.accessionNumber, acceptedAt);
      }
    }
    if (failed.length > 0) {
      log(
        `edgar poll failed for ${failed.length} of ${companies.length} companies (${failed.join(', ')}): ${firstFailure}`,
      );
    }
    if (stopped) return;
    pausedUntil = null;
    nextPauseMs = PAUSE_MIN_MS;
    lastPollAt = now();
  }

  const loop = () => {
    if (stopped) return;
    current = poll()
      .catch((error: unknown) => log(`edgar poll failed: ${describeErrorLine(error)}`))
      .finally(() => {
        current = null;
        if (stopped) return;
        timer = setTimeout(loop, intervalMs);
        timer.unref();
      });
  };

  return {
    poll,
    start: loop,
    status: () => ({
      lastPollAt,
      pausedUntil:
        pausedUntil !== null && now().getTime() < pausedUntil ? new Date(pausedUntil) : null,
    }),
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
      await current;
    },
  };
}
