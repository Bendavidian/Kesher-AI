import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { afterEach, describe, expect, it } from 'vitest';
import { createKesherServer } from './server';
import { mintRunToken, verifyRunToken, type ToolName } from './token';
import type { ToolDeps } from './tools';

const SECRET = 'test-secret-that-is-at-least-32-chars';

// No database: get_event finds nothing, which is enough to prove the call got through.
const deps = {
  events: { findOne: () => Promise.resolve(null) },
  sources: {},
} as unknown as ToolDeps;

let client: Client | undefined;
afterEach(async () => {
  await client?.close();
  client = undefined;
});

async function connect(tools: ToolName[]): Promise<Client> {
  const token = await mintRunToken(SECRET, { userId: randomUUID(), agent: 'research', tools });
  const claims = await verifyRunToken(SECRET, token);
  const server = createKesherServer(deps, claims);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  client = new Client({ name: 'test', version: '0.0.0' });
  await client.connect(clientSide);
  return client;
}

describe('createKesherServer', () => {
  it('lists only the tools the token allows', async () => {
    const both = await connect(['get_event', 'search_news']);
    expect((await both.listTools()).tools.map((tool) => tool.name).sort()).toEqual([
      'get_event',
      'search_news',
    ]);
  });

  it('rejects search_news for a token without it, and still serves get_event', async () => {
    const scoped = await connect(['get_event']);
    expect((await scoped.listTools()).tools.map((tool) => tool.name)).toEqual(['get_event']);
    await expect(
      scoped.callTool({ name: 'search_news', arguments: { query: 'TSMC' } }),
    ).rejects.toThrow(/search_news/);

    const eventId = randomUUID();
    const result = await scoped.callTool({ name: 'get_event', arguments: { eventId } });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain(`No event with id ${eventId}`);
  });

  it('serves no tool that the server has not implemented', async () => {
    const future = await connect(['get_price_reaction']);
    expect((await future.listTools()).tools).toEqual([]);
  });

  it('marks every tool read only', async () => {
    const both = await connect(['get_event', 'search_news']);
    for (const tool of (await both.listTools()).tools) {
      expect(tool.annotations?.readOnlyHint).toBe(true);
    }
  });
});
