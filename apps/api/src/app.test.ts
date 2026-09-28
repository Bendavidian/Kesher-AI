import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { HealthResponse } from '@kesher/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app';

describe('api', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    server = createApp().listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });

  it('GET /health returns ok', async () => {
    const response = await fetch(`${baseUrl}/health`);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/application\/json/);
    expect(HealthResponse.parse(await response.json())).toEqual({ status: 'ok' });
  });
});
