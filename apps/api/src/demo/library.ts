import { DEMO_PERSONAS, type PersonaKey, type UniverseSymbol } from '@kesher/shared';
import type { Db } from 'mongodb';
import { collection } from '../db/collections';
import type { LazyEmbedder } from '../embed/event';
import type { EvalEvent } from '../eval/dataset';
import { toIncomingItem } from '../ingest/alpaca';
import { findProcessed, processItem } from '../ingest/process';
import { loadRecording, RECORDINGS_DIR } from '../ingest/recordings';
import { isRateLimited, MissingModelKeyError, type ModelClient } from '../llm/client';

// The library of real events on the public instance (SPEC.md decision log, T23): the 30 real items
// of the eval set, from their committed Alpaca recordings, through the normal pipeline (pre filter,
// injection screen, extraction, relevance) into the database the public instance shares. It is a
// data load, not a live decision: no research gate runs, so no research starts and no skipped run
// is stored, and nothing is pushed.

// The 30 items of docs/research/eval-candidates.md. The market wraps that T16 part 2 added to the
// eval set measure passing mentions for the eval only; they are not part of the library.
export const libraryEvents = (events: readonly EvalEvent[]): EvalEvent[] =>
  events.filter((event) => event.type !== 'market_wrap');

// Oldest first, so the order of arrival (FeedItem.createdAt) matches the order of events.
export function libraryOrder(events: readonly EvalEvent[]): EvalEvent[] {
  return [...events].sort(
    (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id),
  );
}

export interface LibraryDeps {
  // The models for one item, asked only when a step needs one. The CLI gives every item the same
  // free tier client; tests give each item its recorded answers.
  modelsFor: (externalId: string) => () => ModelClient;
  embedder?: LazyEmbedder;
  now?: () => Date;
  log?: (message: string) => void;
}

export type LibraryStop =
  | { reason: 'no_recording' }
  | { reason: 'missing_key'; message: string }
  | { reason: 'rate_limited' }
  | { reason: 'dropped'; detail: string };

export interface LibraryResult {
  // Processed by this run: stored, screened, extracted and scored.
  loaded: string[];
  // Already processed before this run; nothing was read or written for them.
  skipped: string[];
  // The first item that did not load, and why. The run stops there, so a later run loads the rest
  // in the same oldest first order.
  stopped: ({ id: string } & LibraryStop) | null;
}

// Loads the items oldest first, one at a time. An item already processed is skipped before the
// pipeline, so a second run writes nothing, not even an ingest counter. The first item that fails
// stops the run: loading a later one first would break the arrival order. Only library events load
// (libraryEvents), whatever the caller passes, so the market wraps never reach the shared database.
export async function loadLibrary(
  db: Db,
  events: readonly EvalEvent[],
  { modelsFor, embedder, now = () => new Date(), log = () => undefined }: LibraryDeps,
  recordingsDir = RECORDINGS_DIR,
): Promise<LibraryResult> {
  const result: LibraryResult = { loaded: [], skipped: [], stopped: null };
  for (const event of libraryOrder(libraryEvents(events))) {
    const recording = await loadRecording(event.id, recordingsDir);
    if (!recording) {
      result.stopped = { id: event.id, reason: 'no_recording' };
      break;
    }
    const item = toIncomingItem(recording.item);
    if (await findProcessed(db, item)) {
      result.skipped.push(event.id);
      continue;
    }
    try {
      const processed = await processItem(db, item, {
        mode: 'replay',
        models: modelsFor(event.id),
        now,
        log,
        ...(embedder ? { embedder } : {}),
      });
      if (processed.outcome !== 'processed') {
        result.stopped = { id: event.id, reason: 'dropped', detail: processed.reason };
        break;
      }
      result.loaded.push(event.id);
      // The id only: the headline is untrusted text.
      log(`loaded ${event.id}`);
    } catch (error) {
      if (error instanceof MissingModelKeyError) {
        result.stopped = { id: event.id, reason: 'missing_key', message: error.message };
      } else if (isRateLimited(error)) {
        result.stopped = { id: event.id, reason: 'rate_limited' };
      } else {
        throw error;
      }
      break;
    }
  }
  return result;
}

export interface PersonaLibrary {
  persona: PersonaKey;
  // The library events above relevance 0 for the persona: its cards.
  cards: number;
  // The library events at relevance 0: its hidden items.
  hidden: number;
  // The event companies of those cards, from the paths code computed.
  eventCompanies: UniverseSymbol[];
  // Every card of the persona in the database, the library and anything else.
  feedCards: number;
}

// The library sources whose injection screen did not finish. The screen fails open, as for live
// items, so such an item still loads; this count makes it visible. Reads only.
export async function unscreenedCount(db: Db, events: readonly EvalEvent[]): Promise<number> {
  return collection(db, 'sources').countDocuments({
    provider: 'alpaca',
    externalId: { $in: libraryEvents(events).map((event) => event.id) },
    injectionScreen: null,
  });
}

// What each persona sees of the library, read from the stored FeedItems. Reads only.
export async function libraryReport(
  db: Db,
  events: readonly EvalEvent[],
): Promise<PersonaLibrary[]> {
  const sources = await collection(db, 'sources')
    .find({
      provider: 'alpaca',
      externalId: { $in: libraryEvents(events).map((event) => event.id) },
    })
    .project<{ _id: string }>({ _id: 1 })
    .toArray();
  const eventIds = (
    await collection(db, 'market_events')
      .find({ sourceIds: { $in: sources.map((source) => source._id) } })
      .project<{ _id: string }>({ _id: 1 })
      .toArray()
  ).map((event) => event._id);

  const report: PersonaLibrary[] = [];
  for (const { key, email } of DEMO_PERSONAS) {
    const user = await collection(db, 'users').findOne({ email }, { projection: { _id: 1 } });
    if (!user) continue;
    const items = await collection(db, 'feed_items')
      .find({ userId: user._id, eventId: { $in: eventIds } })
      .toArray();
    const cards = items.filter((item) => item.relevance > 0);
    report.push({
      persona: key,
      cards: cards.length,
      hidden: items.length - cards.length,
      eventCompanies: [
        ...new Set(cards.flatMap((item) => (item.path ? [item.path.eventCompany] : []))),
      ].sort(),
      feedCards: await collection(db, 'feed_items').countDocuments({
        userId: user._id,
        relevance: { $gt: 0 },
      }),
    });
  }
  return report;
}
