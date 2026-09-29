import { randomUUID } from 'node:crypto';
import { nameUuid, sourceIdName, type GetFinancialFactsOutput } from '@kesher/mcp';
import { Source } from '@kesher/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { collection } from '../db/collections';
import { ensureCollections, ensureIndexes } from '../db/indexes';
import { MONGO_START_TIMEOUT_MS, startTestMongo, type TestMongo } from '../test/mongo';
import { storeToolSources } from './toolSources';

const TEN_K = '0001045810-26-000021';
const TEN_Q = '0001045810-26-000075';
const now = new Date('2026-09-29T12:00:00Z');
const storedTenK = randomUUID();

const facts: GetFinancialFactsOutput = {
  symbol: 'NVDA',
  metrics: [],
  filings: [
    {
      sourceId: nameUuid(sourceIdName('sec_edgar', TEN_Q)),
      accn: TEN_Q,
      form: '10-Q',
      filed: '2026-08-26',
      url: 'https://www.sec.gov/Archives/edgar/data/1045810/000104581026000075/',
      title: 'NVIDIA 10-Q filed 2026-08-26',
    },
    {
      // The tool names the stored 10-K by its own id.
      sourceId: storedTenK,
      accn: TEN_K,
      form: '10-K',
      filed: '2026-02-25',
      url: 'https://www.sec.gov/Archives/edgar/data/1045810/000104581026000021/',
      title: 'NVIDIA 10-K filed 2026-02-25',
    },
  ],
  omitted: 0,
};

describe('storeToolSources for get_financial_facts on mongod', () => {
  let mongo: TestMongo;

  beforeAll(async () => {
    mongo = await startTestMongo('kesher_tool_sources_test');
    await ensureCollections(mongo.db);
    await ensureIndexes(mongo.db);
    await collection(mongo.db, 'sources').insertOne({
      _id: storedTenK,
      provider: 'sec_edgar',
      kind: 'filing',
      tier: 1,
      externalId: TEN_K,
      url: 'https://www.sec.gov/Archives/edgar/data/1045810/000104581026000021/nvda-20260125.htm',
      author: null,
      publisher: null,
      title: 'NVIDIA 10-K for the fiscal year ended 2026-01-25',
      text: null,
      symbols: ['NVDA'],
      publishedAt: new Date('2026-02-25T21:00:00Z'),
      injectionScreen: null,
      createdAt: new Date('2026-09-29T00:00:00Z'),
    });
  }, MONGO_START_TIMEOUT_MS);

  afterAll(async () => {
    await mongo?.stop();
  });

  it('stores a new filing under the id the tool named and leaves a stored one alone', async () => {
    const ids = await storeToolSources(mongo.db, 'get_financial_facts', facts, now);
    expect(ids).toEqual([nameUuid(sourceIdName('sec_edgar', TEN_Q)), storedTenK]);

    const tenQ = Source.parse(await collection(mongo.db, 'sources').findOne({ externalId: TEN_Q }));
    expect(tenQ).toMatchObject({
      provider: 'sec_edgar',
      kind: 'filing',
      tier: 1,
      text: null,
      symbols: ['NVDA'],
      title: 'NVIDIA 10-Q filed 2026-08-26',
    });
    const tenK = await collection(mongo.db, 'sources').findOne({ externalId: TEN_K });
    expect(tenK?.title).toBe('NVIDIA 10-K for the fiscal year ended 2026-01-25');

    // Idempotent.
    await storeToolSources(mongo.db, 'get_financial_facts', facts, now);
    expect(await collection(mongo.db, 'sources').countDocuments()).toBe(2);
  });

  it('stores nothing for another tool or an output of another shape', async () => {
    expect(await storeToolSources(mongo.db, 'search_news', facts, now)).toEqual([]);
    expect(await storeToolSources(mongo.db, 'get_financial_facts', { filings: 'x' }, now)).toEqual(
      [],
    );
  });
});
