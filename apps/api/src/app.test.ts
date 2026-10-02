import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { HealthResponse } from '@kesher/shared';
import { MongoClient } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { SESSION_COOKIE, signSession } from './auth/session';

async function listen(app: ReturnType<typeof createApp>): Promise<{ server: Server; url: string }> {
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  return { server, url: `http://127.0.0.1:${port}` };
}

const close = (server: Server) =>
  new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );

// /health and a body the parser refuses never touch the db; the client is never connected.
const unusedDb = () => new MongoClient('mongodb://127.0.0.1:1').db('unused');

describe('api', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    ({ server, url: baseUrl } = await listen(createApp({ db: unusedDb(), devRoutes: false })));
  });

  afterAll(() => close(server));

  it('GET /health returns ok', async () => {
    const response = await fetch(`${baseUrl}/health`);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/application\/json/);
    expect(HealthResponse.parse(await response.json())).toEqual({ status: 'ok', demoMode: false });
  });
});

// One error middleware and one error shape for REST; /mcp answers in JSON-RPC (SPEC.md decision
// log, T30).
describe('body errors', () => {
  const secret = 'a test secret of at least 32 characters';
  let server: Server;
  let baseUrl: string;
  const errors: unknown[] = [];
  let cookie: string;

  beforeAll(async () => {
    ({ server, url: baseUrl } = await listen(
      createApp({
        db: unusedDb(),
        devRoutes: false,
        auth: { secret, secureCookie: false },
        mcp: { secret: 'an mcp test secret of at least 32 characters' },
        logError: (error) => errors.push(error),
      }),
    ));
    cookie = `${SESSION_COOKIE}=${await signSession(secret, '00000000-0000-4000-8000-000000000001')}`;
  });

  afterAll(async () => {
    await close(server);
    // None of the client errors is logged.
    expect(errors).toEqual([]);
  });

  const send = (method: string, path: string, body: string, headers: Record<string, string> = {}) =>
    fetch(`${baseUrl}${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      body,
    });

  // Every REST route that reads a body, with a body over its limit.
  const routes = [
    { method: 'POST', path: '/auth/login', tooLarge: 11 * 1024 },
    { method: 'POST', path: '/guest', tooLarge: 3 * 1024 },
    { method: 'PUT', path: '/guest/portfolio', tooLarge: 3 * 1024, signedIn: true },
  ];

  it.each(routes)('$method $path answers 400 invalid json', async ({ method, path, signedIn }) => {
    const response = await send(method, path, '{not json', signedIn ? { cookie } : {});
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'invalid json' });
  });

  it.each(routes)(
    '$method $path answers 413 for a body over its limit',
    async ({ method, path, tooLarge, signedIn }) => {
      const body = JSON.stringify({ symbols: ['x'.repeat(tooLarge)] });
      const response = await send(method, path, body, signedIn ? { cookie } : {});
      expect(response.status).toBe(413);
      expect(await response.json()).toEqual({ error: 'body too large' });
    },
  );

  it('POST /mcp answers a JSON-RPC parse error for a body that is not JSON', async () => {
    const response = await send('POST', '/mcp', '{"jsonrpc":');
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      jsonrpc: '2.0',
      error: { code: -32700, message: 'Parse error' },
      id: null,
    });
  });

  it('POST /mcp answers a JSON-RPC error for a body over its limit', async () => {
    const response = await send('POST', '/mcp', JSON.stringify({ pad: 'x'.repeat(1024 * 1024) }));
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({
      jsonrpc: '2.0',
      error: { code: -32600, message: 'Request body too large' },
      id: null,
    });
  });

  it('answers another body the parser cannot read with its 4xx', async () => {
    const response = await send('POST', '/auth/login', '{}', { 'content-encoding': 'br-unknown' });
    expect(response.status).toBe(415);
    expect(await response.json()).toEqual({ error: 'unreadable body' });
  });
});
