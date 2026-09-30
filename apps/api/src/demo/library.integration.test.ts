import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { COLLECTION_NAMES, collection } from '../db/collections';
import { loadEvents, type EvalEvent } from '../eval/dataset';
import { replayModels, seedEvalDb } from '../eval/runner';
import { createModelClient, resolveFromKeys } from '../llm/client';
import { loadModelRecording } from '../llm/recordings';
import { MONGO_START_TIMEOUT_MS, startTestMongo, type TestMongo } from '../test/mongo';
import {
  libraryOrder,
  libraryReport,
  loadLibrary,
  unscreenedCount,
  type LibraryDeps,
} from './library';

// npm run demo:library on a local mongod, with each item's recorded model answers: never a
// provider call.

const start = new Date('2026-10-01T09:00:00.000Z');

// A clock a second apart per call, so every write has its own arrival time.
function ticking() {
  let calls = 0;
  return () => new Date(start.getTime() + calls++ * 1_000);
}

async function recordedDeps(events: readonly EvalEvent[]): Promise<LibraryDeps> {
  const recorded = new Map(
    await Promise.all(
      events.map(async (event) => [event.id, (await loadModelRecording(event.id))!] as const),
    ),
  );
  return { modelsFor: (id) => replayModels(recorded.get(id)!), now: ticking() };
}

// Every model call fails the test: a run that should write nothing must ask for none.
const noModels: LibraryDeps = {
  modelsFor: (id) => () => {
    throw new Error(`no model call expected, asked for ${id}`);
  },
};

// Everything the database holds, per collection, to compare two runs.
async function snapshot(mongo: TestMongo) {
  const entries = await Promise.all(
    COLLECTION_NAMES.map(
      async (name) =>
        [
          name,
          await collection(mongo.db, name)
            .find({}, { sort: { _id: 1 } })
            .toArray(),
        ] as const,
    ),
  );
  return Object.fromEntries(entries);
}

describe('the event library on mongod', () => {
  let mongo: TestMongo;
  let events: EvalEvent[];

  beforeAll(async () => {
    mongo = await startTestMongo('kesher_library_test');
    await seedEvalDb(mongo.db, start);
    events = await loadEvents();
  }, MONGO_START_TIMEOUT_MS);

  afterAll(async () => {
    await mongo?.stop();
  });

  it('loads the 30 items oldest first, and a second run changes nothing', async () => {
    const first = await loadLibrary(mongo.db, events, await recordedDeps(events));
    expect(first.stopped).toBeNull();
    expect(first.skipped).toEqual([]);
    expect(first.loaded).toEqual(libraryOrder(events).map((event) => event.id));

    const before = await snapshot(mongo);
    const second = await loadLibrary(mongo.db, events, noModels);
    expect(second).toEqual({ loaded: [], skipped: first.loaded, stopped: null });
    expect(await snapshot(mongo)).toEqual(before);
  }, 120_000);

  it('arrives in the order of the events, for every persona', async () => {
    const published = new Map(
      (await collection(mongo.db, 'market_events').find({}).toArray()).map((event) => [
        event._id,
        event.publishedAt.getTime(),
      ]),
    );
    const users = await collection(mongo.db, 'users').find({}).toArray();
    expect(users).toHaveLength(3);
    for (const user of users) {
      const items = await collection(mongo.db, 'feed_items')
        .find({ userId: user._id })
        .sort({ createdAt: 1, _id: 1 })
        .toArray();
      expect(items).toHaveLength(30);
      const times = items.map((item) => published.get(item.eventId)!);
      expect(times).toEqual([...times].sort((a, b) => a - b));
    }
  });

  it('screens every item', async () => {
    expect(await unscreenedCount(mongo.db, events)).toBe(0);
  });

  it('starts no research and stores no run', async () => {
    expect(await collection(mongo.db, 'agent_runs').countDocuments()).toBe(0);
    expect(
      await collection(mongo.db, 'feed_items').countDocuments({
        'research.state': { $ne: 'none' },
      }),
    ).toBe(0);
  });

  it('gives C only the KO, JNJ and XOM items', async () => {
    const report = await libraryReport(mongo.db, events);
    const c = report.find((persona) => persona.persona === 'C')!;
    expect(c).toMatchObject({ cards: 5, hidden: 25, feedCards: 5 });
    expect(c.eventCompanies).toEqual(['JNJ', 'KO', 'XOM']);
    for (const persona of report) expect(persona.cards + persona.hidden).toBe(30);
  });
});

describe('an interrupted library load on mongod', () => {
  let mongo: TestMongo;

  beforeAll(async () => {
    mongo = await startTestMongo('kesher_library_stop_test');
    await seedEvalDb(mongo.db, start);
  }, MONGO_START_TIMEOUT_MS);

  afterAll(async () => {
    await mongo?.stop();
  });

  it('stops at the first item that fails and loads the rest, in order, on the next run', async () => {
    const events = libraryOrder(await loadEvents()).slice(0, 4);
    const recorded = await recordedDeps(events);
    const third = events[2]!.id;
    const failing: LibraryDeps = {
      ...recorded,
      // No key for the third item's models: the run stops there.
      modelsFor: (id) =>
        id === third
          ? () => createModelClient({ resolve: resolveFromKeys({}) })
          : recorded.modelsFor(id),
    };

    const first = await loadLibrary(mongo.db, events, failing);
    expect(first.loaded).toEqual([events[0]!.id, events[1]!.id]);
    expect(first.stopped).toMatchObject({ id: third, reason: 'missing_key' });
    // The fourth item was never reached.
    expect(await collection(mongo.db, 'sources').countDocuments({ provider: 'alpaca' })).toBe(3);

    const second = await loadLibrary(mongo.db, events, recorded);
    expect(second).toEqual({
      loaded: [third, events[3]!.id],
      skipped: [events[0]!.id, events[1]!.id],
      stopped: null,
    });
  }, 60_000);
});
