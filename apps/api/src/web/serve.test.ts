import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HealthResponse } from '@kesher/shared';
import { MongoClient } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { TEST_JWT_SECRET } from '../test/api';
import { serveWeb } from './serve';

const SHELL = '<!doctype html><div id="root"></div>';

describe('the api serving the web build (production)', () => {
  let dist: string;
  let server: Server;
  let url: string;

  beforeAll(async () => {
    // Under a dot directory, as a checkout under .claude/worktrees is.
    dist = join(mkdtempSync(join(tmpdir(), 'kesher-web-')), '.checkout', 'dist');
    mkdirSync(dist, { recursive: true });
    writeFileSync(join(dist, 'index.html'), SHELL);
    mkdirSync(join(dist, 'assets'));
    writeFileSync(join(dist, 'assets', 'index-abc123.js'), 'console.log(1)');
    writeFileSync(join(dist, 'favicon.svg'), '<svg/>');
    // These requests never reach the database: the client is never connected.
    const db = new MongoClient('mongodb://127.0.0.1:1').db('unused');
    server = createApp({
      db,
      devRoutes: false,
      demo: {},
      web: dist,
      auth: { secret: TEST_JWT_SECRET, secureCookie: true },
      logError: () => undefined,
    }).listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    rmSync(join(dist, '..', '..'), { recursive: true, force: true });
  });

  it('answers /health at the root and under /api, with demo mode on', async () => {
    for (const path of ['/health', '/api/health']) {
      const response = await fetch(`${url}${path}`);
      expect(response.status, path).toBe(200);
      expect(HealthResponse.parse(await response.json())).toEqual({ status: 'ok', demoMode: true });
    }
  });

  it('serves the app shell for / and for client routes that share a name with an api route', async () => {
    for (const path of ['/', '/runs', '/runs/00000000-0000-4000-8000-000000000001', '/feed']) {
      const response = await fetch(`${url}${path}`);
      expect(response.status, path).toBe(200);
      expect(response.headers.get('content-type'), path).toMatch(/text\/html/);
      expect(response.headers.get('cache-control'), path).toBe('no-cache');
      expect(await response.text(), path).toBe(SHELL);
    }
  });

  it('answers HEAD for the shell', async () => {
    const response = await fetch(`${url}/reports/x`, { method: 'HEAD' });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/text\/html/);
  });

  it('serves hashed assets as immutable and other files as no-cache', async () => {
    const asset = await fetch(`${url}/assets/index-abc123.js`);
    expect(asset.status).toBe(200);
    expect(asset.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(await asset.text()).toBe('console.log(1)');
    const icon = await fetch(`${url}/favicon.svg`);
    expect(icon.status).toBe(200);
    expect(icon.headers.get('cache-control')).toBe('no-cache');
  });

  it('answers 404 JSON for a missing file, never the shell', async () => {
    const response = await fetch(`${url}/assets/missing.js`);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'not found' });
  });

  it('takes the api routes under /api, with the prefix stripped', async () => {
    const feed = await fetch(`${url}/api/feed`);
    expect(feed.status).toBe(401);
    expect(await feed.json()).toEqual({ error: 'sign in required' });
    const replay = await fetch(`${url}/api/demo/replay`, { method: 'POST' });
    expect(replay.status).toBe(401);
  });

  it('answers 404 JSON for an unknown path under /api', async () => {
    for (const [method, path] of [
      ['GET', '/api/nothing'],
      ['GET', '/api'],
      ['POST', '/api/dev/replay/38062166'],
      ['POST', '/api/dev/reset/38062166'],
    ] as const) {
      const response = await fetch(`${url}${path}`, { method });
      expect(response.status, path).toBe(404);
      expect(await response.json(), path).toEqual({ error: 'not found' });
    }
  });

  it('keeps api routes off the root paths, except /health, /mcp and /socket.io', async () => {
    const login = await fetch(`${url}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(login.status).toBe(404);
    const demo = await fetch(`${url}/demo/replay`, { method: 'POST' });
    expect(demo.status).toBe(404);
  });

  it('matches /api and the root paths by exact case, so /API and /Health get the shell', async () => {
    for (const path of ['/API/feed', '/Health', '/Api']) {
      const response = await fetch(`${url}${path}`);
      expect(response.status, path).toBe(200);
      expect(await response.text(), path).toBe(SHELL);
    }
    expect((await fetch(`${url}/MCP`, { method: 'POST' })).status).toBe(404);
  });

  it('keeps a query on /api with a leading slash', async () => {
    const response = await fetch(`${url}/api?x=1`);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'not found' });
  });

  it('refuses to start without a web build', () => {
    expect(() => serveWeb(join(dist, 'nothing'))).toThrow(/web build is missing/);
  });
});
