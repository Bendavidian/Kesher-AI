import { randomUUID } from 'node:crypto';
import { Company, INVERSE_TYPE, Relationship, Source, UNIVERSE, User } from '@kesher/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { verifyPassword } from '../auth/password';
import { buildCompanies, buildRelationships, buildSources, buildUsers } from './build';
import { DEMO_PASSWORD, DEMO_SOURCE_ID, DEMO_SOURCE_PROVIDER } from './config';

const now = new Date('2026-09-28T00:00:00Z');

describe('seed documents', () => {
  const sources = buildSources(now);
  const companies = buildCompanies(now);
  // The seed reads real Source ids back from the database; here each gets a fresh one.
  const sourceIds = new Map<string, string>(sources.map((s) => [s.externalId, randomUUID()]));
  const relationships = buildRelationships(now, sourceIds);
  let users: User[];

  beforeAll(async () => {
    users = await buildUsers(now);
  });

  it('all parse against their schemas', () => {
    for (const doc of sources) expect(Source.parse(doc)).toEqual(doc);
    for (const doc of companies) expect(Company.parse(doc)).toEqual(doc);
    for (const doc of relationships) expect(Relationship.parse(doc)).toEqual(doc);
    for (const doc of users) expect(User.parse(doc)).toEqual(doc);
  });

  it('cover exactly the demo universe', () => {
    expect(companies.map((c) => c.symbol).sort()).toEqual([...UNIVERSE].sort());
  });

  it('keep primaryListing next to the US symbol', () => {
    const listing = (symbol: string) => companies.find((c) => c.symbol === symbol)?.primaryListing;
    expect(listing('TSM')).toBe('2330.TW');
    expect(listing('ASML')).toBe('ASML.AS');
    expect(listing('NVDA')).toBe('NVDA');
  });

  it('seed the three personas with the SPEC.md holdings', async () => {
    const holdings = users.map((u) => u.holdings.map((h) => h.symbol));
    expect(holdings).toEqual([
      ['NVDA', 'MSFT', 'AMZN'],
      ['AMD', 'AVGO', 'TSM', 'ASML'],
      ['KO', 'JNJ', 'XOM'],
    ]);
    for (const user of users) {
      expect(await verifyPassword(DEMO_PASSWORD, user.passwordHash)).toBe(true);
    }
  });

  it('store six reviewed edges in both directions with the inverse type', () => {
    expect(relationships).toHaveLength(12);
    const key = (r: Pick<Relationship, 'from' | 'to' | 'type'>) => `${r.from}|${r.type}|${r.to}`;
    const keys = new Set(relationships.map(key));
    expect(keys.size).toBe(12);
    for (const edge of relationships) {
      const inverse = { from: edge.to, to: edge.from, type: INVERSE_TYPE[edge.type] };
      expect(keys.has(key(inverse)), key(edge)).toBe(true);
      expect(edge.evidence.reviewed).toBe(true);
    }
    const supplierEdges = relationships.filter((r) => r.type === 'supplier_of').map(key);
    expect(supplierEdges.sort()).toEqual([
      'LRCX|supplier_of|TSM',
      'TSM|supplier_of|AMD',
      'TSM|supplier_of|AVGO',
      'TSM|supplier_of|NVDA',
    ]);
  });

  it('link every edge to a seeded filing source', () => {
    const known = new Set(sourceIds.values());
    for (const edge of relationships) expect(known.has(edge.evidence.sourceId)).toBe(true);
    expect(sources).toHaveLength(4);
    expect(new Set(relationships.map((r) => r.evidence.sourceId)).size).toBe(4);
  });

  it('refuse to build an edge whose filing source is missing', () => {
    expect(() => buildRelationships(now, new Map())).toThrow(/no Source/);
  });

  it('never connect the unrelated persona', () => {
    const unrelated = new Set(['KO', 'JNJ', 'XOM']);
    for (const edge of relationships) {
      expect(unrelated.has(edge.from) || unrelated.has(edge.to)).toBe(false);
    }
  });

  it('pin the demo item by its Alpaca id', () => {
    expect(DEMO_SOURCE_PROVIDER).toBe('alpaca');
    expect(DEMO_SOURCE_ID).toBe('38062166');
  });
});
