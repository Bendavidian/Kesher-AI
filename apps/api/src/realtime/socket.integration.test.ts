import {
  DEMO_SOURCE_ID,
  EventExplain,
  EventScored,
  FeedCard,
  ReplayResponse,
  ResetResponse,
  SOCKET_EVENTS,
  type PersonaKey,
} from '@kesher/shared';
import { io as connect, type Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createModelClient, MODELS } from '../llm/client';
import { loadModelRecording } from '../llm/recordings';
import { scoreEvent } from '../relevance/feed';
import { runSeed } from '../seed/seed';
import { signIn, startApi, type TestApi } from '../test/api';
import { mockModel, resolveMocks } from '../test/models';
import { MONGO_START_TIMEOUT_MS, startTestMongo, type TestMongo } from '../test/mongo';

const now = new Date('2026-09-28T12:00:00Z');
const PERSONAS: PersonaKey[] = ['A', 'B', 'C'];

const revive = (value: unknown) =>
  JSON.parse(JSON.stringify(value), (_key, v: unknown) =>
    typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(v) ? new Date(v) : v,
  ) as unknown;

// One open browser session: its socket and everything the server pushed to it.
interface Session {
  cookie: string;
  socket: Socket;
  items: FeedCard[];
  updates: FeedCard[];
  scored: EventScored[];
}

describe('live feed over Socket.IO, on mongod', () => {
  let mongo: TestMongo;
  let api: TestApi;
  let modelCalls: () => number;
  const sessions = {} as Record<PersonaKey, Session>;

  const open = (cookie: string) =>
    new Promise<Socket>((resolve, reject) => {
      const socket = connect(api.url, {
        transports: ['websocket'],
        extraHeaders: { cookie },
        reconnection: false,
      });
      socket.once('connect', () => resolve(socket));
      socket.once('connect_error', (error) => {
        socket.close();
        reject(error);
      });
    });
  const post = async (path: string) => {
    const response = await fetch(`${api.url}${path}`, { method: 'POST' });
    expect(response.status, path).toBe(200);
    return await response.json();
  };
  const explain = async (eventId: string, cookie: string) =>
    EventExplain.parse(
      revive(
        await (await fetch(`${api.url}/events/${eventId}/explain`, { headers: { cookie } })).json(),
      ),
    );
  // Resolves once every session has seen event:scored for the event, which the server sends
  // after the cards.
  const allScored = (eventId: string) =>
    Promise.all(
      PERSONAS.map(
        (key) =>
          new Promise<void>((resolve) => {
            const check = () => {
              if (sessions[key].scored.some((s) => s.eventId === eventId)) resolve();
              else setTimeout(check, 10);
            };
            check();
          }),
      ),
    );

  beforeAll(async () => {
    mongo = await startTestMongo('kesher_socket_test');
    await runSeed(mongo.db, now);
    const recorded = (await loadModelRecording(DEMO_SOURCE_ID))!;
    const guard = mockModel(MODELS.screen.model, recorded.screen.chunks);
    const groq = mockModel(MODELS.extraction.model, [recorded.extraction.text]);
    const client = createModelClient({
      resolve: resolveMocks({ [guard.modelId]: guard, [groq.modelId]: groq }),
    });
    modelCalls = () => guard.doGenerateCalls.length + groq.doGenerateCalls.length;
    api = await startApi(mongo.db, { models: () => client });

    for (const key of PERSONAS) {
      const cookie = await signIn(api.url, key);
      const session: Session = {
        cookie,
        socket: await open(cookie),
        items: [],
        updates: [],
        scored: [],
      };
      session.socket.on(SOCKET_EVENTS.feedItem, (card: unknown) =>
        session.items.push(FeedCard.parse(revive(card))),
      );
      session.socket.on(SOCKET_EVENTS.feedUpdate, (card: unknown) =>
        session.updates.push(FeedCard.parse(revive(card))),
      );
      session.socket.on(SOCKET_EVENTS.eventScored, (scored: unknown) =>
        session.scored.push(EventScored.parse(scored)),
      );
      sessions[key] = session;
    }
  }, MONGO_START_TIMEOUT_MS);

  afterEach(() => {
    for (const key of PERSONAS) {
      sessions[key].items = [];
      sessions[key].updates = [];
      sessions[key].scored = [];
    }
  });

  afterAll(async () => {
    for (const key of PERSONAS) sessions[key]?.socket.close();
    await api?.close();
    await mongo?.stop();
  });

  it('replaying the TSMC event gives three open sessions three different results', async () => {
    const replay = ReplayResponse.parse(await post(`/dev/replay/${DEMO_SOURCE_ID}`));
    if (replay.outcome !== 'processed') throw new Error(`dropped: ${replay.reason}`);
    await allScored(replay.eventId);

    // A: High through the supplier path, with the NVIDIA 10-K quote.
    expect(sessions.A.items).toHaveLength(1);
    const [a] = sessions.A.items;
    expect(a?.item).toMatchObject({
      eventId: replay.eventId,
      relevance: 0.8,
      path: { eventCompany: 'TSM', holding: 'NVDA', hops: [{ type: 'supplier_of' }] },
    });
    expect(a?.evidence[0]?.quote).toContain('Taiwan Semiconductor Manufacturing Company Limited');

    // B: High, directly held.
    expect(sessions.B.items).toHaveLength(1);
    expect(sessions.B.items[0]?.item).toMatchObject({
      relevance: 1,
      path: { holding: 'TSM', hops: [] },
    });

    // C: no card at all, only the signal; explain gives None.
    expect(sessions.C.items).toEqual([]);
    expect(sessions.C.scored).toEqual([{ eventId: replay.eventId }]);
    expect(await explain(replay.eventId, sessions.C.cookie)).toMatchObject({
      relevance: 0,
      path: null,
    });

    // Each session got only its own card.
    expect(a?.item.userId).not.toBe(sessions.B.items[0]?.item.userId);
    expect([...sessions.A.updates, ...sessions.B.updates, ...sessions.C.updates]).toEqual([]);
  });

  it('a second replay is a duplicate and pushes nothing', async () => {
    const replay = ReplayResponse.parse(await post(`/dev/replay/${DEMO_SOURCE_ID}`));
    expect(replay).toMatchObject({ outcome: 'dropped', reason: 'duplicate' });

    await new Promise((resolve) => setTimeout(resolve, 100));
    for (const key of PERSONAS) {
      expect(sessions[key].items).toEqual([]);
      expect(sessions[key].scored).toEqual([]);
    }
  });

  it('reset then replay pushes the event as new again, with no model call', async () => {
    const calls = modelCalls();

    const reset = ResetResponse.parse(await post(`/dev/reset/${DEMO_SOURCE_ID}`));
    expect(reset.deleted).toBe(3);
    const replay = ReplayResponse.parse(await post(`/dev/replay/${DEMO_SOURCE_ID}`));
    expect(replay).toMatchObject({
      outcome: 'processed',
      sourceCreated: false,
      eventCreated: false,
    });
    await allScored(reset.eventId);

    expect(modelCalls()).toBe(calls);
    expect(sessions.A.items.map((c) => c.item.relevance)).toEqual([0.8]);
    expect(sessions.B.items.map((c) => c.item.relevance)).toEqual([1]);
    expect(sessions.C.items).toEqual([]);
  });

  it('scoring an event again pushes feed:update, not feed:item', async () => {
    const reset = ResetResponse.parse(await post(`/dev/reset/${DEMO_SOURCE_ID}`));
    await post(`/dev/replay/${DEMO_SOURCE_ID}`);
    await allScored(reset.eventId);
    for (const key of PERSONAS) {
      sessions[key].items = [];
      sessions[key].scored = [];
    }

    const scored = await scoreEvent(mongo.db, reset.eventId, new Date(now.getTime() + 60_000));
    await api.realtime.publishScored(reset.eventId, scored);
    await allScored(reset.eventId);

    expect(sessions.A.updates.map((c) => c.item.relevance)).toEqual([0.8]);
    expect(sessions.B.updates.map((c) => c.item.relevance)).toEqual([1]);
    expect(sessions.C.updates).toEqual([]);
    expect(sessions.A.items).toEqual([]);
  });

  it('closes the sockets of a user who signs out, and no longer pushes to them', async () => {
    const cookie = await signIn(api.url, 'A');
    const socket = await open(cookie);
    const closed = new Promise<string>((resolve) => socket.once('disconnect', resolve));
    const other = sessions.B.socket;

    const response = await fetch(`${api.url}/auth/logout`, {
      method: 'POST',
      headers: { cookie },
    });
    expect(response.status).toBe(204);

    expect(await closed).toBe('io server disconnect');
    // Every socket of that user closes, and nobody else's.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(sessions.A.socket.connected).toBe(false);
    expect(other.connected).toBe(true);
    socket.close();
  });

  it('refuses a socket without a valid session cookie', async () => {
    await expect(open('')).rejects.toThrow('sign in required');
    await expect(open('kesher_session=forged')).rejects.toThrow('sign in required');
  });
});
