import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ReplayResponse } from '@kesher/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { collection } from '../db/collections';
import { ensureCollections, ensureIndexes } from '../db/indexes';
import { DEMO_SOURCE_ID } from '../seed/config';
import { MONGO_START_TIMEOUT_MS, startTestMongo, type TestMongo } from '../test/mongo';

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

async function close(server: Server | undefined): Promise<void> {
  if (!server) return;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

describe('POST /dev/replay/:sourceId', () => {
  let mongo: TestMongo;
  let server: Server;
  let prodServer: Server;
  let baseUrl: string;
  let prodUrl: string;

  const replay = (id: string, url = baseUrl) =>
    fetch(`${url}/dev/replay/${id}`, { method: 'POST' });
  const counts = async () => ({
    sources: await collection(mongo.db, 'sources').countDocuments({ externalId: DEMO_SOURCE_ID }),
    events: await collection(mongo.db, 'market_events').countDocuments(),
  });

  beforeAll(async () => {
    mongo = await startTestMongo('kesher_replay_test');
    await ensureCollections(mongo.db);
    await ensureIndexes(mongo.db);
    server = createApp({ db: mongo.db, devRoutes: true }).listen(0);
    baseUrl = await listen(server);
    prodServer = createApp({ db: mongo.db, devRoutes: false }).listen(0);
    prodUrl = await listen(prodServer);
  }, MONGO_START_TIMEOUT_MS);

  afterAll(async () => {
    await close(server);
    await close(prodServer);
    await mongo?.stop();
  });

  it('replaying DEMO_SOURCE_ID creates exactly one Source and one MarketEvent', async () => {
    const response = await replay(DEMO_SOURCE_ID);

    expect(response.status).toBe(200);
    const body = ReplayResponse.parse(await response.json());
    expect(body).toMatchObject({ sourceCreated: true, eventCreated: true });
    expect(await counts()).toEqual({ sources: 1, events: 1 });

    const event = await collection(mongo.db, 'market_events').findOne({ _id: body.eventId });
    expect(event?.sourceIds).toEqual([body.sourceId]);
  });

  it('a second replay returns the same ids and creates nothing', async () => {
    const [first, second] = [
      ReplayResponse.parse(await (await replay(DEMO_SOURCE_ID)).json()),
      ReplayResponse.parse(await (await replay(DEMO_SOURCE_ID)).json()),
    ];

    expect(second).toEqual({ ...first, sourceCreated: false, eventCreated: false });
    expect(await counts()).toEqual({ sources: 1, events: 1 });
  });

  it('answers 400 for an id that is not an Alpaca news id', async () => {
    for (const id of ['abc', '38062166.json', '%2E%2E%2Fx']) {
      expect((await replay(id)).status, id).toBe(400);
    }
  });

  it('answers 404 for an id with no recording', async () => {
    const response = await replay('999');
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'no recording for Alpaca news 999' });
  });

  it('is not mounted when dev routes are off', async () => {
    expect((await replay(DEMO_SOURCE_ID, prodUrl)).status).toBe(404);
  });
});
