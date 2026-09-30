import {
  DEMO_SOURCE_ID,
  DemoReplayResponse,
  EventScored,
  FeedCard,
  SOCKET_EVENTS,
  type PersonaKey,
} from '@kesher/shared';
import { io as connect, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadModelRecording } from '../llm/recordings';
import { runSeed } from '../seed/seed';
import { recordedModels, signIn, startApi, type TestApi } from '../test/api';
import { MONGO_START_TIMEOUT_MS, startTestMongo, type TestMongo } from '../test/mongo';

const now = new Date('2026-09-30T12:00:00Z');
const PERSONAS: PersonaKey[] = ['A', 'B', 'C'];

const revive = (value: unknown) =>
  JSON.parse(JSON.stringify(value), (_key, v: unknown) =>
    typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(v) ? new Date(v) : v,
  ) as unknown;

interface Session {
  cookie: string;
  socket: Socket;
  items: FeedCard[];
  scored: EventScored[];
}

describe('POST /demo/replay, on mongod', () => {
  let mongo: TestMongo;
  // Demo mode with no cooldown, as a development server would run it but without dev routes.
  let api: TestApi;
  // Demo mode with the default cooldown.
  let cooled: TestApi;
  // Demo mode off.
  let plain: TestApi;
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
  const demoReplay = (url: string, cookie?: string) =>
    fetch(`${url}/demo/replay`, { method: 'POST', headers: cookie ? { cookie } : {} });
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
  const clear = () => {
    for (const key of PERSONAS) {
      sessions[key].items = [];
      sessions[key].scored = [];
    }
  };

  beforeAll(async () => {
    mongo = await startTestMongo('kesher_demo_test');
    await runSeed(mongo.db, now);
    const models = recordedModels((await loadModelRecording(DEMO_SOURCE_ID))!);
    api = await startApi(mongo.db, { models, devRoutes: false, demo: { cooldownMs: 0 } });
    cooled = await startApi(mongo.db, { models, devRoutes: false, demo: {} });
    plain = await startApi(mongo.db, { models, devRoutes: false });
    for (const key of PERSONAS) {
      const cookie = await signIn(api.url, key);
      const session: Session = { cookie, socket: await open(cookie), items: [], scored: [] };
      session.socket.on(SOCKET_EVENTS.feedItem, (card: unknown) =>
        session.items.push(FeedCard.parse(revive(card))),
      );
      session.socket.on(SOCKET_EVENTS.eventScored, (scored: unknown) =>
        session.scored.push(EventScored.parse(scored)),
      );
      sessions[key] = session;
    }
  }, MONGO_START_TIMEOUT_MS);

  afterAll(async () => {
    for (const key of PERSONAS) sessions[key]?.socket.close();
    await api?.close();
    await cooled?.close();
    await plain?.close();
    await mongo?.stop();
  });

  it('answers 401 without a session, and replays nothing', async () => {
    const response = await demoReplay(api.url);
    expect(response.status).toBe(401);
    expect(
      await mongo.db.collection('sources').countDocuments({ externalId: DEMO_SOURCE_ID }),
    ).toBe(0);
  });

  it('replays the pinned item for a signed in user: nothing to reset the first time', async () => {
    clear();
    const response = await demoReplay(api.url, sessions.C.cookie);
    expect(response.status).toBe(200);
    const body = DemoReplayResponse.parse(await response.json());
    expect(body.reset).toBeNull();
    expect(body.replay).toMatchObject({ outcome: 'processed' });
    if (body.replay.outcome !== 'processed') throw new Error('not processed');
    await allScored(body.replay.eventId);

    // The three persona levels: A through the supplier path, B direct, C none.
    expect(sessions.A.items.map((c) => c.item.relevance)).toEqual([0.8]);
    expect(sessions.B.items.map((c) => c.item.relevance)).toEqual([1]);
    expect(sessions.C.items).toEqual([]);
  });

  it('resets the event for every user, then pushes the card again as new', async () => {
    clear();
    const response = await demoReplay(api.url, sessions.A.cookie);
    expect(response.status).toBe(200);
    const body = DemoReplayResponse.parse(await response.json());
    expect(body.reset?.deleted).toBe(3);
    expect(body.replay).toMatchObject({
      outcome: 'processed',
      sourceCreated: false,
      eventCreated: false,
    });
    await allScored(body.reset!.eventId);
    expect(sessions.A.items.map((c) => c.item.relevance)).toEqual([0.8]);
    expect(sessions.B.items.map((c) => c.item.relevance)).toEqual([1]);
  });

  it('takes no id: a path with one is not a route', async () => {
    const response = await fetch(`${api.url}/demo/replay/${DEMO_SOURCE_ID}`, {
      method: 'POST',
      headers: { cookie: sessions.A.cookie },
    });
    expect(response.status).toBe(404);
  });

  it('waits out the cooldown after a replay, with Retry-After', async () => {
    const cookie = await signIn(cooled.url, 'A');
    expect((await demoReplay(cooled.url, cookie)).status).toBe(200);
    const again = await demoReplay(cooled.url, cookie);
    expect(again.status).toBe(429);
    const retryAfter = Number(again.headers.get('retry-after'));
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(15);
    expect(await again.json()).toEqual({
      error: `the demo was just replayed; replay again in ${retryAfter} s`,
    });
  });

  it('never mounts the development routes beside it', async () => {
    for (const path of [`/dev/replay/${DEMO_SOURCE_ID}`, `/dev/reset/${DEMO_SOURCE_ID}`]) {
      expect((await fetch(`${api.url}${path}`, { method: 'POST' })).status, path).toBe(404);
    }
  });

  it('is not mounted when demo mode is off, and health says so', async () => {
    const cookie = await signIn(plain.url, 'A');
    expect((await demoReplay(plain.url, cookie)).status).toBe(404);
    expect(await (await fetch(`${plain.url}/health`)).json()).toEqual({
      status: 'ok',
      demoMode: false,
    });
    expect(await (await fetch(`${api.url}/health`)).json()).toEqual({
      status: 'ok',
      demoMode: true,
    });
  });
});
