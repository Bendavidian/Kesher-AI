import { FeedCard, FeedItem, type PriceSymbol } from '@kesher/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { collection } from '../db/collections';
import { toIncomingItem } from '../ingest/alpaca';
import { processItem } from '../ingest/process';
import { loadRecording } from '../ingest/recordings';
import { createModelClient, MODELS } from '../llm/client';
import { loadModelRecording } from '../llm/recordings';
import { loadReactionFixture } from '../market/fixture';
import { DEMO_SOURCE_ID, FILINGS, PERSONAS } from '../seed/config';
import { runSeed } from '../seed/seed';
import { mockModel, resolveMocks } from '../test/models';
import { MONGO_START_TIMEOUT_MS, startTestMongo, type TestMongo } from '../test/mongo';
import { feedCard, feedCardsFor, type CardMarket } from './cards';

const now = new Date('2026-09-28T12:00:00Z');

describe('FeedCards for the replayed demo event, on mongod', () => {
  let mongo: TestMongo;
  const userId = async (index: number) =>
    (await collection(mongo.db, 'users').findOne({ email: PERSONAS[index]!.email }))!._id;

  beforeAll(async () => {
    mongo = await startTestMongo('kesher_cards_test');
    await runSeed(mongo.db, now);
    const recorded = (await loadModelRecording(DEMO_SOURCE_ID))!;
    const guard = mockModel(MODELS.screen.model, recorded.screen.chunks);
    const groq = mockModel(MODELS.extraction.model, [recorded.extraction.text]);
    const client = createModelClient({
      resolve: resolveMocks({ [guard.modelId]: guard, [groq.modelId]: groq }),
    });
    const item = toIncomingItem((await loadRecording(DEMO_SOURCE_ID))!.item);
    await processItem(mongo.db, item, {
      mode: 'replay',
      models: () => client,
      now: () => now,
      log: () => {},
    });
  }, MONGO_START_TIMEOUT_MS);

  afterAll(async () => {
    await mongo?.stop();
  });

  it('gives A the supplier path with the NVIDIA 10-K quote as evidence', async () => {
    const [card] = await feedCardsFor(mongo.db, await userId(0));

    expect(FeedCard.parse(card)).toEqual(card);
    expect(card?.item).toMatchObject({ relevance: 0.8, confidence: 'medium' });
    expect(card?.event.headline).toBe(
      'TSMC Suspends Chip Production After Taiwan Rocked By Strongest Tremor In 25 Years',
    );
    expect(card?.event).not.toHaveProperty('embedding');
    expect(card?.source).toMatchObject({
      provider: 'alpaca',
      externalId: DEMO_SOURCE_ID,
      tier: 2,
      publisher: 'Benzinga',
    });
    expect(card?.source).not.toHaveProperty('text');
    expect(card?.evidence).toHaveLength(1);
    const [evidence] = card!.evidence;
    expect(evidence).toMatchObject({
      from: 'TSM',
      to: 'NVDA',
      type: 'supplier_of',
      reviewed: true,
      filingDate: FILINGS.NVDA.filingDate,
      filing: { symbol: 'NVDA', form: '10-K', tier: 1, title: FILINGS.NVDA.source.title },
    });
    expect(evidence?.quote).toContain('Taiwan Semiconductor Manufacturing Company Limited');
    expect(card?.priceReaction).toBeNull();
  });

  it('gives B a direct card without evidence, and C an empty feed', async () => {
    const [b] = await feedCardsFor(mongo.db, await userId(1));

    expect(b?.item).toMatchObject({ relevance: 1, path: { holding: 'TSM', hops: [] } });
    expect(b?.evidence).toEqual([]);
    expect(await feedCardsFor(mongo.db, await userId(2))).toEqual([]);
  });

  it("still assembles C's stored relevance 0 item as a card, for the few callers that need it", async () => {
    const stored = await collection(mongo.db, 'feed_items').findOne({ userId: await userId(2) });
    const card = await feedCard(mongo.db, FeedItem.parse(stored));

    expect(card?.item).toMatchObject({ relevance: 0, path: null });
    expect(card?.evidence).toEqual([]);
  });

  it('shows no evidence for a hop whose edge is no longer reviewed', async () => {
    const [card] = await feedCardsFor(mongo.db, await userId(0));
    const edgeId = card!.item.path!.hops[0]!.relationshipId;
    const edges = collection(mongo.db, 'relationships');
    await edges.updateOne({ _id: edgeId }, { $set: { 'evidence.reviewed': false } });
    try {
      expect((await feedCard(mongo.db, card!.item))?.evidence).toEqual([]);
    } finally {
      await edges.updateOne({ _id: edgeId }, { $set: { 'evidence.reviewed': true } });
    }
  });

  it('adds the price reaction of the path, from the headline time, next to the benchmarks', async () => {
    const { reaction } = await loadReactionFixture(DEMO_SOURCE_ID);
    const asked: { subjects: readonly PriceSymbol[]; headline: Date }[] = [];
    const market: CardMarket = {
      priceReaction: (subjects, headline) => {
        asked.push({ subjects, headline });
        return Promise.resolve(reaction);
      },
      logError: () => {
        throw new Error('nothing should fail');
      },
    };
    const [a] = await feedCardsFor(mongo.db, await userId(0), { market });
    const [b] = await feedCardsFor(mongo.db, await userId(1), { market });

    expect(a?.priceReaction).toEqual(reaction);
    expect(FeedCard.parse(a)).toEqual(a);
    const headline = new Date('2024-04-03T03:57:09Z');
    // A: the event company, then the holding. B holds the event company itself.
    expect(asked).toEqual([
      { subjects: ['TSM', 'NVDA'], headline },
      { subjects: ['TSM'], headline },
    ]);
    expect(b?.priceReaction).toEqual(reaction);
  });

  it('keeps the card with a null price reaction when market data fails, and logs it', async () => {
    const logged: unknown[] = [];
    const market: CardMarket = {
      priceReaction: () => Promise.reject(new Error('Alpaca bars answered 500')),
      logError: (error) => logged.push(error),
    };
    const [card] = await feedCardsFor(mongo.db, await userId(0), { market });
    expect(card?.item.relevance).toBe(0.8);
    expect(card?.priceReaction).toBeNull();
    expect(logged).toHaveLength(1);
  });

  it('gives up on a reaction that does not arrive in time', async () => {
    const logged: unknown[] = [];
    const market: CardMarket = {
      priceReaction: () => new Promise(() => {}),
      logError: (error) => logged.push(error),
      timeoutMs: 20,
    };
    const [card] = await feedCardsFor(mongo.db, await userId(0), { market });
    expect(card?.priceReaction).toBeNull();
    expect(String(logged[0])).toContain('took longer than 20 ms');
  });

  it('asks nothing for a relevance 0 item, which has no path', async () => {
    const stored = await collection(mongo.db, 'feed_items').findOne({ userId: await userId(2) });
    const market: CardMarket = {
      priceReaction: () => Promise.reject(new Error('not asked')),
      logError: () => {
        throw new Error('not asked');
      },
    };
    expect((await feedCard(mongo.db, FeedItem.parse(stored), market))?.priceReaction).toBeNull();
  });

  it("returns only the given user's cards, and none for a user without items", async () => {
    const a = await userId(0);
    const cards = await feedCardsFor(mongo.db, a);
    expect(cards.every((card) => card.item.userId === a)).toBe(true);
    expect(await feedCardsFor(mongo.db, '33333333-3333-4333-8333-333333333333')).toEqual([]);
  });
});
