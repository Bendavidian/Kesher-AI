import { Company, type EdgarFiling } from '@kesher/shared';
import type { Db } from 'mongodb';
import { describeError } from '../config/redact';
import { collection } from '../db/collections';
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
  stop(): Promise<void>;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

  async function poll(): Promise<void> {
    const since = new Date(now().getTime() - lookbackMs);
    for (const [accession, acceptedAt] of seen) {
      if (acceptedAt < since.getTime()) seen.delete(accession);
    }
    const companies = (
      await collection(db, 'companies').find({}).sort({ symbol: 1 }).toArray()
    ).map((doc) => Company.parse(doc));
    for (const [index, company] of companies.entries()) {
      if (stopped) return;
      if (index > 0) await sleep(gapMs);
      let filings: EdgarFiling[];
      try {
        filings = await fetchRecentFilings(company.cik, since, { userAgent, fetch });
      } catch (error) {
        log(`edgar poll for ${company.symbol} failed: ${describeError(error)}`);
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
  }

  const loop = () => {
    if (stopped) return;
    current = poll()
      .catch((error: unknown) => log(`edgar poll failed: ${describeError(error)}`))
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
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
      await current;
    },
  };
}
