import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { TOOLS, queryTerms, rankNews } from './tools';

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
  it('registers the T07 tools', () => {
    expect(TOOLS.map((tool) => tool.name)).toEqual(['get_event', 'search_news']);
  });

  it.each(TOOLS.map((tool) => [tool.name, tool] as const))(
    '%s has no argument that names a user',
    (_name, tool) => {
      const names = propertyNames(z.toJSONSchema(tool.inputSchema));
      expect(names.length).toBeGreaterThan(0);
      expect(names.filter((name) => USER_LIKE.test(name))).toEqual([]);
    },
  );

  it('rejects a user id smuggled in as an extra argument', () => {
    const userId = randomUUID();
    const valid: Record<string, object> = {
      get_event: { eventId: randomUUID() },
      search_news: { query: 'TSMC earthquake' },
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
