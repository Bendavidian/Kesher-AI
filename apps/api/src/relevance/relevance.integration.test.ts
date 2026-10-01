import { Relationship, type Extraction, type UniverseSymbol } from '@kesher/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { collection } from '../db/collections';
import { ingestItem } from '../ingest/ingest';
import { PERSONAS } from '../seed/config';
import { runSeed } from '../seed/seed';
import { MONGO_START_TIMEOUT_MS, startTestMongo, type TestMongo } from '../test/mongo';
import { scoreEvent, type ScoredItem } from './feed';
import { loadEdges } from './graph';

const now = new Date('2026-09-28T12:00:00Z');

describe('relevance on the seeded graph, on mongod', () => {
  let mongo: TestMongo;
  const userIds: Record<'A' | 'B' | 'C', string> = { A: '', B: '', C: '' };

  // Stores a news item and gives its event an extraction, as processItem would.
  let nextId = 1;
  const extractedEvent = async (
    companies: UniverseSymbol[],
    symbols: UniverseSymbol[] = companies,
  ) => {
    const id = String(nextId++);
    const { eventId } = await ingestItem(
      mongo.db,
      {
        provider: 'alpaca',
        kind: 'news',
        tier: 2,
        externalId: id,
        url: `https://example.com/${id}`,
        author: null,
        publisher: 'Benzinga',
        title: `News about ${companies.join(', ')}`,
        text: null,
        symbols,
        publishedAt: now,
      },
      now,
    );
    const extraction: Extraction = {
      companies: companies.map((symbol) => ({ symbol, impact: 'negative' })),
      eventType: 'other',
      themes: [],
      importance: 4,
      provider: 'groq',
      model: 'openai/gpt-oss-120b',
      extractedAt: now,
    };
    await collection(mongo.db, 'market_events').updateOne(
      { _id: eventId },
      { $set: { extraction } },
    );
    return eventId;
  };

  const byPersona = (scored: ScoredItem[]) => {
    const items = scored.map((s) => s.item);
    return {
      A: items.find((item) => item.userId === userIds.A),
      B: items.find((item) => item.userId === userIds.B),
      C: items.find((item) => item.userId === userIds.C),
    };
  };

  beforeAll(async () => {
    mongo = await startTestMongo('kesher_relevance_test');
    await runSeed(mongo.db, now);
    for (const [index, key] of (['A', 'B', 'C'] as const).entries()) {
      const user = await collection(mongo.db, 'users').findOne({ email: PERSONAS[index]!.email });
      userIds[key] = user!._id;
    }
  }, MONGO_START_TIMEOUT_MS);

  afterAll(async () => {
    await mongo?.stop();
  });

  describe('loadEdges', () => {
    it('follows reviewed edges for two hops with $graphLookup, and no further', async () => {
      const edges = await loadEdges(mongo.db, ['TSM']);
      const pairs = new Set(edges.map((e) => `${e.from} ${e.type} ${e.to}`));
      // Hop 1 leaves TSM; hop 2 leaves the companies TSM reaches.
      expect(pairs).toContain('TSM supplier_of NVDA');
      expect(pairs).toContain('TSM customer_of LRCX');
      expect(pairs).toContain('NVDA competitor_of AMD');
      expect(pairs).toContain('AMD competitor_of INTC');
      // INTC is two hops away, so its own edges would be a third hop.
      expect(edges.some((e) => e.from === 'INTC')).toBe(false);
    });

    it('never loads an unreviewed edge', async () => {
      const template = await collection(mongo.db, 'relationships').findOne({ from: 'TSM' });
      const unreviewed = Relationship.parse({
        ...template,
        _id: '11111111-1111-4111-8111-111111111111',
        from: 'TSM',
        to: 'MU',
        type: 'supplier_of',
        evidence: { ...template!.evidence, reviewed: false },
      });
      await collection(mongo.db, 'relationships').insertOne(unreviewed);
      try {
        const edges = await loadEdges(mongo.db, ['TSM']);
        expect(edges.some((e) => e._id === unreviewed._id)).toBe(false);
      } finally {
        await collection(mongo.db, 'relationships').deleteOne({ _id: unreviewed._id });
      }
    });

    it('returns nothing for no companies', async () => {
      expect(await loadEdges(mongo.db, [])).toEqual([]);
    });
  });

  describe('scoreEvent', () => {
    it('scores the TSMC event high for B directly, high for A by supplier path, none for C', async () => {
      const eventId = await extractedEvent(['TSM']);
      const items = byPersona(await scoreEvent(mongo.db, eventId, now));

      expect(items.B).toMatchObject({
        relevance: 1,
        path: { eventCompany: 'TSM', holding: 'TSM', hops: [] },
      });
      expect(items.A).toMatchObject({
        relevance: 0.8,
        path: {
          eventCompany: 'TSM',
          holding: 'NVDA',
          hops: [{ from: 'TSM', to: 'NVDA', type: 'supplier_of', weight: 0.8 }],
        },
      });
      expect(items.C).toMatchObject({ relevance: 0, path: null });
      // One Tier 2 wire: medium, the same for every user.
      for (const item of Object.values(items)) {
        expect(item).toMatchObject({
          eventId,
          confidence: 'medium',
          status: 'confirmed',
          research: { state: 'none', runId: null, reportId: null },
        });
      }
    });

    it('traverses both directions: AMD news reaches A, NVDA news reaches a TSM holder', async () => {
      const amd = byPersona(await scoreEvent(mongo.db, await extractedEvent(['AMD']), now));
      expect(amd.A).toMatchObject({
        relevance: 0.6,
        path: {
          eventCompany: 'AMD',
          holding: 'NVDA',
          hops: [{ from: 'AMD', to: 'NVDA', type: 'competitor_of' }],
        },
      });

      const nvda = byPersona(await scoreEvent(mongo.db, await extractedEvent(['NVDA']), now));
      expect(nvda.B).toMatchObject({
        relevance: 0.8,
        path: {
          eventCompany: 'NVDA',
          holding: 'TSM',
          hops: [{ from: 'NVDA', to: 'TSM', type: 'customer_of' }],
        },
      });
    });

    it('ignores a company the text names but the provider never tagged', async () => {
      // Tagged KO only; the untrusted text also names NVDA, and the model extracted both.
      const eventId = await extractedEvent(['KO', 'NVDA'], ['KO']);
      const items = byPersona(await scoreEvent(mongo.db, eventId, now));

      expect(items.A).toMatchObject({ relevance: 0, path: null });
      expect(items.C).toMatchObject({ relevance: 1, path: { holding: 'KO', hops: [] } });
      const stored = await collection(mongo.db, 'market_events').findOne({ _id: eventId });
      expect(stored?.extraction?.companies.map((c) => c.symbol)).toEqual(['KO', 'NVDA']);
    });

    it('gives a medium card for a company the provider tagged but the extraction never named', async () => {
      // A market wrap tagged KO and NVDA that is about KO and mentions NVDA in passing.
      const eventId = await extractedEvent(['KO'], ['KO', 'NVDA']);
      const items = byPersona(await scoreEvent(mongo.db, eventId, now));

      expect(items.C).toMatchObject({
        relevance: 1,
        path: { eventCompany: 'KO', named: true, holding: 'KO', hops: [] },
      });
      expect(items.A).toMatchObject({
        relevance: 0.5,
        path: { eventCompany: 'NVDA', named: false, holding: 'NVDA', hops: [] },
      });
      expect(items.B).toMatchObject({
        relevance: 0.4,
        path: {
          eventCompany: 'NVDA',
          named: false,
          holding: 'TSM',
          hops: [{ from: 'NVDA', to: 'TSM', type: 'customer_of' }],
        },
      });
    });

    it('keeps one item per user and its ids when scored again', async () => {
      const eventId = await extractedEvent(['TSM']);
      const first = await scoreEvent(mongo.db, eventId, now);
      const later = new Date(now.getTime() + 60_000);
      const second = await scoreEvent(mongo.db, eventId, later);

      expect(first.every((s) => s.created)).toBe(true);
      expect(second.every((s) => !s.created)).toBe(true);
      expect(second.map((s) => s.item._id)).toEqual(first.map((s) => s.item._id));
      expect(second.every((s) => s.item.createdAt.getTime() === now.getTime())).toBe(true);
      expect(second.every((s) => s.item.updatedAt.getTime() === later.getTime())).toBe(true);
      expect(await collection(mongo.db, 'feed_items').countDocuments({ eventId })).toBe(3);
    });

    it('refuses an event without an extraction', async () => {
      const { eventId } = await ingestItem(
        mongo.db,
        {
          provider: 'alpaca',
          kind: 'news',
          tier: 2,
          externalId: 'unextracted',
          url: 'https://example.com/unextracted',
          author: null,
          publisher: null,
          title: 'Not extracted yet',
          text: null,
          symbols: ['TSM'],
          publishedAt: now,
        },
        now,
      );
      await expect(scoreEvent(mongo.db, eventId, now)).rejects.toThrow('no extraction');
    });

    it('names an event that does not exist', async () => {
      const missing = '22222222-2222-4222-8222-222222222222';
      await expect(scoreEvent(mongo.db, missing, now)).rejects.toThrow(
        `event ${missing} not found`,
      );
    });
  });
});
