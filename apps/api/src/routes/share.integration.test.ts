import { randomUUID } from 'node:crypto';
import {
  DEMO_PERSONAS,
  DEMO_SOURCE_ID,
  ReportDetail,
  ShareResponse,
  type Source,
} from '@kesher/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { collection } from '../db/collections';
import { toIncomingItem } from '../ingest/alpaca';
import { processItem } from '../ingest/process';
import { loadRecording } from '../ingest/recordings';
import { loadModelRecording } from '../llm/recordings';
import { runSeed } from '../seed/seed';
import type { UploadedImage, Uploader } from '../share/cloudinary';
import { recordedModels, sessionCookieOf, signIn, startApi, type TestApi } from '../test/api';
import { MONGO_START_TIMEOUT_MS, startTestMongo, type TestMongo } from '../test/mongo';

const eventTime = new Date('2026-09-29T12:00:00Z');
const shareTime = Date.parse('2026-10-02T10:00:00Z');

const revive = (value: unknown) =>
  JSON.parse(JSON.stringify(value), (_key, v: unknown) =>
    typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(v) ? new Date(v) : v,
  ) as unknown;

// A fake Cloudinary: records each upload and answers the URL Cloudinary would. No test reaches
// the real service.
function fakeCloudinary() {
  const uploads: { png: Buffer; publicId: string }[] = [];
  let failNext = false;
  let hold: Promise<void> | null = null;
  const upload: Uploader = async (png, publicId): Promise<UploadedImage> => {
    uploads.push({ png, publicId });
    if (hold) await hold;
    if (failNext) {
      failNext = false;
      throw new Error('Cloudinary answered 500');
    }
    return { url: `https://res.cloudinary.com/test/image/upload/v1/${publicId}.png`, publicId };
  };
  return {
    upload,
    uploads,
    failOnce: () => (failNext = true),
    // Holds every upload until the returned release is called.
    holdUploads: () => {
      let release!: () => void;
      hold = new Promise((resolve) => (release = resolve));
      return () => {
        hold = null;
        release();
      };
    },
  };
}

describe('POST /reports/:reportId/share, on mongod (T30)', () => {
  let mongo: TestMongo;
  let api: TestApi;
  let eventId: string;
  let demo: Source;
  let userA: string;
  let cookieA: string;
  let cookieB: string;
  const cloudinary = fakeCloudinary();

  // A report of persona A on the demo event: a supported fact, a supported inference on it and a
  // removed fact.
  async function reportOfA(): Promise<string> {
    const runId = randomUUID();
    const reportId = randomUUID();
    const [fact, inference, removed] = [randomUUID(), randomUUID(), randomUUID()];
    const at = eventTime;
    await collection(mongo.db, 'agent_runs').insertOne({
      _id: runId,
      userId: userA,
      eventId,
      agent: 'research',
      mode: 'deep',
      trigger: 'investigate',
      gate: { decision: 'run', reason: 'investigate' },
      stepBudget: 12,
      tokenBudget: 32_000,
      steps: [],
      tokensUsed: 0,
      verification: null,
      costUsd: 0,
      status: 'succeeded',
      failureReason: null,
      startedAt: at,
      finishedAt: at,
      createdAt: at,
    });
    await collection(mongo.db, 'reports').insertOne({
      _id: reportId,
      runId,
      sections: [{ title: 'Findings', claimIds: [fact, inference, removed] }],
      openQuestions: [],
      omitted: [],
      createdAt: at,
    });
    const base = { reportId, origin: 'model' as const, checks: [], createdAt: at };
    await collection(mongo.db, 'claims').insertMany([
      {
        ...base,
        _id: fact,
        type: 'fact',
        text: 'TSMC paused some production after the earthquake.',
        sources: [{ sourceId: demo._id, quote: demo.text!.slice(0, 60) }],
        premises: [],
        status: 'supported',
      },
      {
        ...base,
        _id: inference,
        type: 'inference',
        text: 'An inference that stays off the card.',
        sources: [],
        premises: [fact],
        status: 'supported',
      },
      {
        ...base,
        _id: removed,
        type: 'fact',
        text: 'A removed claim that stays off the card.',
        sources: [{ sourceId: demo._id, quote: 'not in the text' }],
        premises: [],
        status: 'removed',
      },
    ]);
    return reportId;
  }

  const share = (reportId: string, cookie?: string, url = api.url) =>
    fetch(`${url}/reports/${reportId}/share`, {
      method: 'POST',
      headers: cookie ? { cookie } : {},
    });

  beforeAll(async () => {
    mongo = await startTestMongo('kesher_share_test');
    await runSeed(mongo.db, eventTime);
    const result = await processItem(
      mongo.db,
      toIncomingItem((await loadRecording(DEMO_SOURCE_ID))!.item),
      {
        mode: 'replay',
        models: recordedModels((await loadModelRecording(DEMO_SOURCE_ID))!),
        now: () => eventTime,
        log: () => {},
      },
    );
    if (result.outcome !== 'processed') throw new Error('expected processed');
    eventId = result.eventId;
    demo = (await collection(mongo.db, 'sources').findOne({ _id: result.sourceId }))!;
    const email = DEMO_PERSONAS.find((persona) => persona.key === 'A')!.email;
    userA = (await collection(mongo.db, 'users').findOne({ email }))!._id;
    api = await startApi(mongo.db, {
      share: { upload: cloudinary.upload, now: () => shareTime, limit: 1000 },
      guest: { createLimit: 1000 },
      // Mounts GET /reports/:reportId, which carries shareImage to the report screen.
      research: true,
    });
    cookieA = await signIn(api.url, 'A');
    cookieB = await signIn(api.url, 'B');
  }, MONGO_START_TIMEOUT_MS);

  afterAll(async () => {
    await api?.close();
    await mongo?.stop();
  });

  it('renders the card once, stores its URL on the report and answers it again', async () => {
    const reportId = await reportOfA();
    const before = cloudinary.uploads.length;

    const first = await share(reportId, cookieA);
    expect(first.status).toBe(201);
    const { url } = ShareResponse.parse(await first.json());
    expect(url).toBe(
      `https://res.cloudinary.com/test/image/upload/v1/kesher/reports/${reportId}.png`,
    );

    const [upload] = cloudinary.uploads.slice(before);
    expect(upload!.publicId).toBe(`kesher/reports/${reportId}`);
    expect(upload!.png.subarray(1, 4).toString()).toBe('PNG');
    const stored = await collection(mongo.db, 'reports').findOne({ _id: reportId });
    expect(stored!.shareImage).toEqual({
      url,
      publicId: `kesher/reports/${reportId}`,
      createdAt: new Date(shareTime),
    });

    const again = await share(reportId, cookieA);
    expect(again.status).toBe(200);
    expect(ShareResponse.parse(await again.json())).toEqual({ url });
    expect(cloudinary.uploads.length).toBe(before + 1);

    // The report screen reads it with the report.
    const detail = await fetch(`${api.url}/reports/${reportId}`, { headers: { cookie: cookieA } });
    expect(ReportDetail.parse(revive(await detail.json())).report.shareImage?.url).toBe(url);
  });

  it('uploads once when the same report is shared twice at once', async () => {
    const reportId = await reportOfA();
    const before = cloudinary.uploads.length;
    const release = cloudinary.holdUploads();
    const pending = [share(reportId, cookieA), share(reportId, cookieA)];
    // Both requests are in the api before the upload answers.
    while (cloudinary.uploads.length === before) await new Promise((r) => setTimeout(r, 5));
    await new Promise((r) => setTimeout(r, 50));
    release();
    const responses = await Promise.all(pending);

    expect(responses.map((response) => response.status).sort()).toEqual([200, 201]);
    const urls = await Promise.all(responses.map(async (r) => ShareResponse.parse(await r.json())));
    expect(urls[0]).toEqual(urls[1]);
    expect(cloudinary.uploads.length).toBe(before + 1);
  });

  it("answers 404 for another user's report and for an unknown one, uploading nothing", async () => {
    const reportId = await reportOfA();
    const before = cloudinary.uploads.length;
    for (const id of [reportId, randomUUID()]) {
      const response = await share(id, cookieB);
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: 'no report with that id' });
    }
    expect(cloudinary.uploads.length).toBe(before);
    expect((await collection(mongo.db, 'reports').findOne({ _id: reportId }))!.shareImage).toBe(
      undefined,
    );
  });

  it('answers 401 without a session and 400 for an id that is not a UUID', async () => {
    expect((await share(await reportOfA())).status).toBe(401);
    expect((await share('not-a-uuid', cookieA)).status).toBe(400);
  });

  it('refuses a guest with 403', async () => {
    const created = await fetch(`${api.url}/guest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ symbols: ['NVDA'] }),
    });
    expect(created.status).toBe(201);
    const response = await share(await reportOfA(), sessionCookieOf(created));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'sharing is for the personas' });
  });

  it('answers 503 when the upload fails, stores nothing, and the next share tries again', async () => {
    const reportId = await reportOfA();
    cloudinary.failOnce();
    const failed = await share(reportId, cookieA);
    expect(failed.status).toBe(503);
    expect(await failed.json()).toEqual({
      error: 'the share image could not be made; try again later',
    });
    expect((await collection(mongo.db, 'reports').findOne({ _id: reportId }))!.shareImage).toBe(
      undefined,
    );
    expect((await share(reportId, cookieA)).status).toBe(201);
  });

  it('answers 503 without CLOUDINARY_URL, and still answers a report already shared', async () => {
    const shared = await reportOfA();
    expect((await share(shared, cookieA)).status).toBe(201);
    const bare = await startApi(mongo.db);
    try {
      const cookie = await signIn(bare.url, 'A');
      const response = await share(await reportOfA(), cookie, bare.url);
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: 'sharing is not configured on this server' });
      expect((await share(shared, cookie, bare.url)).status).toBe(200);
    } finally {
      await bare.close();
    }
  });

  it('answers 429 with Retry-After past the hourly limit', async () => {
    const limited = await startApi(mongo.db, {
      share: { upload: cloudinary.upload, now: () => shareTime, limit: 2 },
    });
    try {
      const cookie = await signIn(limited.url, 'A');
      const reportId = await reportOfA();
      expect((await share(reportId, cookie, limited.url)).status).toBe(201);
      expect((await share(reportId, cookie, limited.url)).status).toBe(200);
      const refused = await share(reportId, cookie, limited.url);
      expect(refused.status).toBe(429);
      expect(refused.headers.get('retry-after')).toBe('3600');
      // Per user: B still shares.
      const cookieOfB = await signIn(limited.url, 'B');
      expect((await share(randomUUID(), cookieOfB, limited.url)).status).toBe(404);
    } finally {
      await limited.close();
    }
  });
});
