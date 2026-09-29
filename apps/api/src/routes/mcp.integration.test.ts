import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mintRunToken, type ToolName } from '@kesher/mcp';
import {
  EMBEDDING_DIMENSIONS,
  PriceReactionError,
  type MarketEvent,
  type PriceSymbol,
  type Source,
  type User,
} from '@kesher/shared';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { collection } from '../db/collections';
import { ensureCollections, ensureIndexes } from '../db/indexes';
import { loadReactionFixture } from '../market/fixture';
import type { PriceReactions } from '../market/reactions';
import { DEMO_SOURCE_ID } from '../seed/config';
import { MONGO_START_TIMEOUT_MS, startTestMongo, type TestMongo } from '../test/mongo';

const SECRET = 'integration-secret-that-is-long-enough';
const personaA = randomUUID();
const personaB = randomUUID();

function source(overrides: Partial<Source> & Pick<Source, 'title' | 'publishedAt'>): Source {
  const id = randomUUID();
  return {
    _id: id,
    provider: 'alpaca',
    kind: 'news',
    tier: 2,
    externalId: id,
    url: `https://example.com/${id}`,
    author: null,
    publisher: 'Benzinga',
    text: null,
    symbols: ['TSM'],
    injectionScreen: null,
    createdAt: new Date('2026-09-28T00:00:00Z'),
    ...overrides,
  };
}

// The demo headline, with a body longer than the excerpt.
const demo = source({
  title: 'TSMC Suspends Chip Production After Taiwan Rocked By Strongest Tremor In 25 Years',
  text: `Taiwan Semiconductor evacuated fabs after the earthquake. ${'More detail. '.repeat(60)}`,
  publishedAt: new Date('2024-04-03T03:57:09Z'),
  symbols: ['TSM', 'NVDA'],
  injectionScreen: { flagged: false, score: 0.01, model: 'prompt-guard', screenedAt: new Date() },
});
const later = source({
  title: 'TSMC says most fab tools recovered',
  publishedAt: new Date('2024-04-04T10:00:00Z'),
});
const older = source({
  title: 'Earthquake drill at Hsinchu park',
  publishedAt: new Date('2024-03-01T10:00:00Z'),
  symbols: ['ASML'],
});
const filing = source({
  title: 'TSMC earthquake 6-K',
  kind: 'filing',
  provider: 'sec_edgar',
  tier: 1,
  publishedAt: new Date('2024-04-05T00:00:00Z'),
});
const filler = Array.from({ length: 12 }, (_, i) =>
  source({
    title: `TSMC daily note ${i}`,
    publishedAt: new Date(Date.UTC(2024, 0, 1 + i)),
  }),
);

const event: MarketEvent = {
  _id: randomUUID(),
  sourceIds: [demo._id],
  headline: demo.title,
  publishedAt: demo.publishedAt,
  status: 'confirmed',
  extraction: {
    companies: [{ symbol: 'TSM', impact: 'negative' }],
    eventType: 'natural_disaster',
    themes: ['foundry'],
    importance: 4,
    provider: 'groq',
    model: 'openai/gpt-oss-120b',
    extractedAt: new Date('2024-04-03T04:00:00Z'),
  },
  embedding: Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.01),
  createdAt: new Date('2024-04-03T04:00:00Z'),
};

function user(_id: string, holdings: User['holdings']): User {
  return {
    _id,
    email: `${_id}@example.com`,
    passwordHash: 'not-a-real-hash',
    displayName: 'Persona',
    holdings,
    interests: [],
    createdAt: new Date('2026-09-28T00:00:00Z'),
  };
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

describe('POST /mcp', () => {
  let mongo: TestMongo;
  let server: Server;
  let baseUrl: string;
  const clients: Client[] = [];
  const asked: { subjects: readonly PriceSymbol[]; headline: Date }[] = [];
  const logged: unknown[] = [];

  beforeAll(async () => {
    mongo = await startTestMongo('kesher_mcp_test');
    await ensureCollections(mongo.db);
    await ensureIndexes(mongo.db);
    await collection(mongo.db, 'sources').insertMany([demo, later, older, filing, ...filler]);
    await collection(mongo.db, 'market_events').insertOne(event);
    await collection(mongo.db, 'users').insertMany([
      user(personaA, [
        { symbol: 'TSM', quantity: 5 },
        { symbol: 'NVDA', quantity: 10 },
      ]),
      user(personaB, [{ symbol: 'KO', quantity: 40 }]),
    ]);
    const { reaction } = await loadReactionFixture(DEMO_SOURCE_ID);
    // The committed demo reaction for any past headline; the real computation is tested in market.
    const priceReactions: PriceReactions = (subjects, headline) => {
      asked.push({ subjects, headline });
      if (headline.getTime() > Date.now()) {
        return Promise.reject(new PriceReactionError('the headline time is in the future'));
      }
      if (subjects[0] === 'KO') return Promise.reject(new Error('Alpaca bars answered 500'));
      return Promise.resolve(reaction);
    };
    server = createApp({
      db: mongo.db,
      devRoutes: false,
      mcp: { secret: SECRET },
      priceReactions,
      logError: (error) => logged.push(error),
    }).listen(0);
    baseUrl = await listen(server);
  }, MONGO_START_TIMEOUT_MS);

  afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.close()));
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    await mongo?.stop();
  });

  async function connect(tools: ToolName[], userId = personaA): Promise<Client> {
    const token = await mintRunToken(SECRET, { userId, agent: 'research', tools });
    const client = new Client({ name: 'test', version: '0.0.0' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
        requestInit: { headers: { authorization: `Bearer ${token}` } },
      }),
    );
    clients.push(client);
    return client;
  }

  const listTools = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} };
  const post = (authorization?: string) =>
    fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...(authorization ? { authorization } : {}),
      },
      body: JSON.stringify(listTools),
    });

  describe('run token', () => {
    it('answers 401 without a valid token and never echoes it', async () => {
      const wrongKey = await mintRunToken('another-secret-that-is-long-enough!!', {
        userId: personaA,
        agent: 'research',
        tools: ['get_event'],
      });
      const expired = await mintRunToken(
        SECRET,
        { userId: personaA, agent: 'research', tools: ['get_event'] },
        new Date(Date.now() - 10 * 60 * 1000),
      );
      for (const authorization of [
        undefined,
        'Basic abc',
        'Bearer not-a-jwt',
        `Bearer ${wrongKey}`,
        `Bearer ${expired}`,
      ]) {
        const response = await post(authorization);
        expect(response.status).toBe(401);
        expect(response.headers.get('www-authenticate')).toContain('invalid_token');
        const body = await response.text();
        expect(body).not.toContain(wrongKey);
        expect(body).not.toContain(expired);
      }
    });

    it('answers a malformed JSON body with 400', async () => {
      const response = await fetch(`${baseUrl}/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{"jsonrpc":',
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: 'invalid json' });
    });

    it('rejects search_news for a token without it, while get_event still works', async () => {
      const client = await connect(['get_event']);
      expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(['get_event']);
      await expect(
        client.callTool({ name: 'search_news', arguments: { query: 'TSMC' } }),
      ).rejects.toThrow(/search_news/);
      const result = await client.callTool({
        name: 'get_event',
        arguments: { eventId: event._id },
      });
      expect(result.isError).toBeFalsy();
    });

    it('rejects a user id passed as an argument', async () => {
      const client = await connect(['get_event', 'search_news']);
      for (const [name, args] of [
        ['get_event', { eventId: event._id, userId: personaB }],
        ['search_news', { query: 'TSMC', userId: personaB }],
      ] as const) {
        const result = await client.callTool({ name, arguments: args });
        expect(result.isError).toBe(true);
        expect(JSON.stringify(result.content)).toContain('userId');
      }
    });
  });

  describe('get_my_portfolio', () => {
    it("returns the token user's holdings and nothing about anyone else", async () => {
      for (const [userId, holdings] of [
        [
          personaA,
          [
            { symbol: 'NVDA', quantity: 10 },
            { symbol: 'TSM', quantity: 5 },
          ],
        ],
        [personaB, [{ symbol: 'KO', quantity: 40 }]],
      ] as const) {
        const client = await connect(['get_my_portfolio'], userId);
        const result = await client.callTool({ name: 'get_my_portfolio', arguments: {} });
        expect(result.structuredContent).toEqual({ holdings });
        expect(JSON.stringify(result.content)).not.toContain('@example.com');
      }
    });

    it('rejects any argument, so a call cannot name another user', async () => {
      const client = await connect(['get_my_portfolio'], personaA);
      const result = await client.callTool({
        name: 'get_my_portfolio',
        arguments: { userId: personaB },
      });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).not.toContain('KO');
    });
  });

  describe('get_event', () => {
    it('returns the event with its extraction and source ids, without the embedding', async () => {
      const client = await connect(['get_event']);
      const result = await client.callTool({
        name: 'get_event',
        arguments: { eventId: event._id },
      });
      expect(result.structuredContent).toEqual({
        eventId: event._id,
        headline: event.headline,
        publishedAt: '2024-04-03T03:57:09.000Z',
        status: 'confirmed',
        extraction: { ...event.extraction, extractedAt: '2024-04-03T04:00:00.000Z' },
        sourceIds: [demo._id],
      });
      expect(JSON.stringify(result)).not.toContain('embedding');
    });

    it('reports an unknown event as a tool error', async () => {
      const client = await connect(['get_event']);
      const missing = randomUUID();
      const result = await client.callTool({ name: 'get_event', arguments: { eventId: missing } });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).toContain(missing);
    });
  });

  describe('search_news', () => {
    interface Hit {
      sourceId: string;
      eventId: string | null;
      excerpt: string | null;
      injectionFlagged: boolean | null;
      matchedTerms: number;
    }
    async function search(args: Record<string, unknown>, userId = personaA): Promise<Hit[]> {
      const client = await connect(['search_news'], userId);
      const result = await client.callTool({ name: 'search_news', arguments: args });
      expect(result.isError).toBeFalsy();
      return (result.structuredContent as { items: Hit[] }).items;
    }

    it('ranks by words matched, then recency, links the event and caps at 10', async () => {
      const items = await search({ query: 'TSMC earthquake' });
      expect(items).toHaveLength(10);
      expect(items[0]).toMatchObject({
        sourceId: demo._id,
        eventId: event._id,
        matchedTerms: 2,
        injectionFlagged: false,
      });
      expect(items[0]?.excerpt).toHaveLength(500);
      expect(items[1]).toMatchObject({ sourceId: later._id, eventId: null, matchedTerms: 1 });
      expect(items.map((item) => item.sourceId)).not.toContain(filing._id);
    });

    it('filters by symbols and since', async () => {
      const bySymbol = await search({ query: 'earthquake', symbols: ['ASML'] });
      expect(bySymbol.map((item) => item.sourceId)).toEqual([older._id]);

      const recent = await search({ query: 'TSMC earthquake', since: '2024-04-01T00:00:00Z' });
      expect(recent.map((item) => item.sourceId)).toEqual([demo._id, later._id]);
    });

    it('treats the query as plain words', async () => {
      expect(await search({ query: '.* (TSMC|' })).toEqual([]);
    });

    it('returns the same results whoever the token names', async () => {
      const args = { query: 'TSMC earthquake' };
      expect(await search(args, personaB)).toEqual(await search(args, personaA));
    });
  });
  describe('get_price_reaction', () => {
    const call = (client: Client, args: Record<string, unknown>) =>
      client.callTool({ name: 'get_price_reaction', arguments: args });

    it('returns the demo reaction for the symbol at the headline time, as JSON', async () => {
      const client = await connect(['get_price_reaction']);
      asked.length = 0;
      const result = await call(client, { symbol: 'TSM', eventTime: '2024-04-02T23:57:09-04:00' });
      expect(result.isError).toBeFalsy();
      expect(asked).toEqual([{ subjects: ['TSM'], headline: new Date('2024-04-03T03:57:09Z') }]);
      const output = result.structuredContent as {
        anchor: { kind: string; baseTime: string; tradingDay: string };
        rows: { symbol: string; moves: { pct: number | null }[] }[];
        delayed: boolean;
      };
      expect(output.anchor).toEqual({
        kind: 'previous_close',
        baseTime: '2024-04-02T20:00:00.000Z',
        tradingDay: '2024-04-03',
      });
      expect(output.rows.map((row) => row.symbol)).toEqual(['TSM', 'NVDA', 'SMH', 'SPY']);
      expect(output.rows[0]!.moves.map((move) => move.pct)).toEqual([-1.16, -0.38, 1.31, 1.25]);
      expect(output.delayed).toBe(true);
    });

    it('gives the reason for a future time, and hides a provider error but logs it', async () => {
      const client = await connect(['get_price_reaction']);
      const future = await call(client, { symbol: 'TSM', eventTime: '2999-01-01T00:00:00Z' });
      expect(future.isError).toBe(true);
      expect(JSON.stringify(future.content)).toContain('the headline time is in the future');

      logged.length = 0;
      const failed = await call(client, { symbol: 'KO', eventTime: '2024-04-03T03:57:09Z' });
      expect(failed.isError).toBe(true);
      expect(JSON.stringify(failed.content)).toContain('Market data is unavailable');
      expect(JSON.stringify(failed.content)).not.toContain('Alpaca');
      expect(logged).toHaveLength(1);
    });

    it('rejects a benchmark or a symbol outside the universe', async () => {
      const client = await connect(['get_price_reaction']);
      for (const symbol of ['SPY', 'AAPL']) {
        const result = await call(client, { symbol, eventTime: '2024-04-03T03:57:09Z' });
        expect(result.isError, symbol).toBe(true);
      }
    });

    it('is missing for a token that does not list it', async () => {
      const client = await connect(['get_event', 'search_news']);
      expect((await client.listTools()).tools.map((tool) => tool.name)).not.toContain(
        'get_price_reaction',
      );
      await expect(
        call(client, { symbol: 'TSM', eventTime: '2024-04-03T03:57:09Z' }),
      ).rejects.toThrow(/get_price_reaction/);
    });
  });
});
