import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { PriceReactionError, type PriceSymbol } from '@kesher/shared';
import { REACTION } from './testing';
import { TOOLS } from './registry';
import { getPriceReaction, priceReactionJson, queryTerms, rankNews, type ToolDeps } from './tools';

// Any argument that could name a user. Identity comes from the run token only (principle 5).
const USER_LIKE = /user|owner|sub|account|persona|holder|email|identity/i;

function propertyNames(schema: unknown): string[] {
  if (Array.isArray(schema)) return schema.flatMap(propertyNames);
  if (typeof schema !== 'object' || schema === null) return [];
  const node = schema as Record<string, unknown>;
  const own =
    typeof node.properties === 'object' && node.properties !== null
      ? Object.keys(node.properties)
      : [];
  return [...own, ...Object.values(node).flatMap(propertyNames)];
}

describe('tool inputs', () => {
  it('registers the implemented tools', () => {
    expect(TOOLS.map((tool) => tool.name)).toEqual([
      'get_my_portfolio',
      'get_event',
      'search_news',
      'get_company_relationships',
      'get_price_reaction',
    ]);
  });

  it.each(TOOLS.map((tool) => [tool.name, tool] as const))(
    '%s has no argument that names a user',
    (name, tool) => {
      const names = propertyNames(z.toJSONSchema(tool.inputSchema));
      // get_my_portfolio takes no argument at all: the user comes from the token.
      if (name !== 'get_my_portfolio') expect(names.length).toBeGreaterThan(0);
      expect(names.filter((property) => USER_LIKE.test(property))).toEqual([]);
    },
  );

  it('rejects a user id smuggled in as an extra argument', () => {
    const userId = randomUUID();
    const valid: Record<string, object> = {
      get_my_portfolio: {},
      get_event: { eventId: randomUUID() },
      search_news: { query: 'TSMC earthquake' },
      get_company_relationships: { symbol: 'NVDA', types: ['customer_of'] },
      get_price_reaction: { symbol: 'TSM', eventTime: '2024-04-03T03:57:09Z' },
    };
    for (const tool of TOOLS) {
      const args = valid[tool.name];
      expect(tool.inputSchema.safeParse(args).success).toBe(true);
      expect(tool.inputSchema.safeParse({ ...args, userId }).success).toBe(false);
      expect(tool.inputSchema.safeParse({ ...args, user_id: userId }).success).toBe(false);
    }
  });
});

describe('search_news query terms', () => {
  it('lowercases, dedupes and caps the terms', () => {
    expect(queryTerms('  TSMC  tsmc Earthquake ')).toEqual(['tsmc', 'earthquake']);
    expect(queryTerms('a b c d e f g h i j')).toHaveLength(8);
  });
});

describe('rankNews', () => {
  const doc = (title: string, text: string | null, iso: string) => ({
    _id: randomUUID(),
    title,
    text,
    publishedAt: new Date(iso),
  });

  it('ranks by distinct terms matched, then by recency, and caps the list', () => {
    const both = doc('TSMC halts production', 'after an earthquake', '2024-04-03T03:00:00Z');
    const oneNew = doc('TSMC shares', null, '2024-04-05T00:00:00Z');
    const oneOld = doc('Quake hits Taiwan', 'earthquake', '2024-04-02T00:00:00Z');
    const ranked = rankNews([oneOld, oneNew, both], ['tsmc', 'earthquake'], 2);
    expect(ranked.map((hit) => hit.doc)).toEqual([both, oneNew]);
    expect(ranked.map((hit) => hit.matchedTerms)).toEqual([2, 1]);
  });
});

describe('get_price_reaction', () => {
  const deps = (priceReaction: ToolDeps['priceReaction']) =>
    ({ events: {}, sources: {}, priceReaction }) as unknown as ToolDeps;
  const ctx = { claims: {} } as Parameters<typeof getPriceReaction.run>[2];
  const input = { symbol: 'TSM', eventTime: '2024-04-03T03:57:09Z' } as const;

  it('accepts demo universe companies only, with a time that has an offset', () => {
    const parse = (args: object) => getPriceReaction.inputSchema.safeParse(args).success;
    expect(parse(input)).toBe(true);
    expect(parse({ symbol: 'NVDA', eventTime: '2024-04-02T23:57:09-04:00' })).toBe(true);
    expect(parse({ ...input, symbol: 'SPY' })).toBe(false);
    expect(parse({ ...input, symbol: 'AAPL' })).toBe(false);
    expect(parse({ ...input, eventTime: '2024-04-03' })).toBe(false);
    expect(parse({ ...input, eventTime: '2024-04-03T03:57:09' })).toBe(false);
  });

  it('asks for the symbol at the headline time and returns ISO times', async () => {
    const asked: { subjects: readonly PriceSymbol[]; headline: Date }[] = [];
    const outcome = await getPriceReaction.run(
      input,
      deps((subjects, headline) => {
        asked.push({ subjects, headline });
        return Promise.resolve(REACTION);
      }),
      ctx,
    );
    expect(asked).toEqual([{ subjects: ['TSM'], headline: new Date('2024-04-03T03:57:09Z') }]);
    expect(outcome).toEqual({ ok: true, output: priceReactionJson(REACTION) });
    if (!outcome.ok) throw new Error('expected output');
    expect(outcome.output.anchor.baseTime).toBe('2024-04-02T20:00:00.000Z');
    expect(outcome.output.rows[0]!.moves[2]).toEqual({ pct: null, barTime: null });
    expect(getPriceReaction.outputSchema.safeParse(outcome.output).success).toBe(true);
  });

  it('passes the reaction reasons on and hides provider errors', async () => {
    const failing = (error: Error) => deps(() => Promise.reject(error));
    expect(
      await getPriceReaction.run(
        input,
        failing(new PriceReactionError('the headline time is in the future')),
        ctx,
      ),
    ).toEqual({ ok: false, error: 'the headline time is in the future' });
    expect(
      await getPriceReaction.run(input, failing(new Error('Alpaca bars answered 403')), ctx),
    ).toEqual({ ok: false, error: 'Market data is unavailable' });
  });
});
