import type { Company, FeedItem, MarketEvent, Relationship } from '@kesher/shared';
import type { FilingView, NewsSourceView, PersonaKey, PriceReaction } from '../view/types';
import { PERSONAS } from './personas';

// The replay demo event with the real spike values (docs/SPIKE.md checks 1, 3 and 4; SPEC.md
// Replay and recording). Ids are fixed placeholders; the api assigns real ones. Relevance and
// paths are what T05 is expected to compute for each persona under the SPEC.md Scores rule.

const REPLAYED_AT = new Date('2026-09-28T12:00:00Z');

// Alpaca news 38062166, the pinned demo item.
export const DEMO_NEWS_SOURCE: NewsSourceView & { wire: string } = {
  _id: '9a3d6c1e-2b4f-4e5a-8c7d-0e1f2a3b4c01',
  provider: 'alpaca',
  wire: 'Benzinga',
  tier: 2,
  externalId: '38062166',
  publishedAt: new Date('2024-04-03T03:57:09Z'),
};

// The NVIDIA 10-K that holds the TSMC quote (apps/api/src/seed/config.ts, FILINGS.NVDA).
export const NVDA_10K_SOURCE_ID = '9a3d6c1e-2b4f-4e5a-8c7d-0e1f2a3b4c02';

export const FILINGS: FilingView[] = [
  { sourceId: NVDA_10K_SOURCE_ID, company: 'NVDA', form: '10-K', tier: 1 },
];

export const DEMO_EVENT: MarketEvent = {
  _id: '4e2c8b7a-6d5f-4a3b-9c1d-2e3f4a5b6c01',
  sourceIds: [DEMO_NEWS_SOURCE._id],
  headline: 'TSMC Suspends Chip Production After Taiwan Rocked By Strongest Tremor In 25 Years',
  publishedAt: DEMO_NEWS_SOURCE.publishedAt,
  status: 'unconfirmed',
  // The Groq result from spike check 4.
  extraction: {
    companies: [{ symbol: 'TSM', impact: 'negative' }],
    eventType: 'natural_disaster',
    themes: ['foundry'],
    importance: 4,
    provider: 'groq',
    model: 'openai/gpt-oss-120b',
    extractedAt: REPLAYED_AT,
  },
  embedding: null,
  createdAt: REPLAYED_AT,
};

export const COMPANIES: Company[] = [
  {
    _id: '3d6b0c8e-1f2a-4b3c-9d4e-5f6a7b8c9d01',
    symbol: 'TSM',
    primaryListing: '2330.TW',
    name: 'Taiwan Semiconductor Manufacturing Co Ltd',
    cik: '0001046179',
    filerType: '20-F',
    sector: 'semiconductors',
    themes: ['foundry'],
    createdAt: REPLAYED_AT,
  },
  {
    _id: '3d6b0c8e-1f2a-4b3c-9d4e-5f6a7b8c9d02',
    symbol: 'NVDA',
    primaryListing: 'NVDA',
    name: 'NVIDIA Corp',
    cik: '0001045810',
    filerType: '10-K',
    sector: 'semiconductors',
    themes: ['ai_accelerators', 'chip_design', 'data_centers'],
    createdAt: REPLAYED_AT,
  },
];

const TSM_SUPPLIES_NVDA_ID = '0b8c3f7e-2f4a-4a51-8d0e-2a4f5c6d7e81';

// The reviewed seed edge, verbatim quote included.
export const RELATIONSHIPS: Relationship[] = [
  {
    _id: TSM_SUPPLIES_NVDA_ID,
    from: 'TSM',
    to: 'NVDA',
    type: 'supplier_of',
    weight: 0.8,
    evidence: {
      sourceId: NVDA_10K_SOURCE_ID,
      quote:
        'We utilize foundries, such as Taiwan Semiconductor Manufacturing Company Limited, or TSMC, and Samsung Electronics Co., Ltd., or Samsung, to produce our semiconductor wafers.',
      filingDate: '2026-02-25',
      url: 'https://www.sec.gov/Archives/edgar/data/1045810/000104581026000021/nvda-20260125.htm',
      reviewed: true,
    },
    createdAt: REPLAYED_AT,
  },
];

function userId(key: PersonaKey): string {
  const persona = PERSONAS.find((p) => p.key === key);
  if (!persona) throw new Error(`no persona ${key}`);
  return persona._id;
}

const itemBase = {
  eventId: DEMO_EVENT._id,
  // One Tier 2 wire source: medium, per the SPEC.md confidence rule.
  confidence: 'medium',
  status: 'unconfirmed',
  research: { state: 'none', runId: null, reportId: null },
  createdAt: REPLAYED_AT,
  updatedAt: REPLAYED_AT,
} as const;

export const FEED_ITEMS: Record<PersonaKey, FeedItem[]> = {
  // One hop, supplier_of: the edge weight.
  A: [
    {
      ...itemBase,
      _id: '6c1d2e3f-4a5b-4c6d-8e7f-8a9b0c1d2e01',
      userId: userId('A'),
      relevance: 0.8,
      path: {
        eventCompany: 'TSM',
        named: true,
        holding: 'NVDA',
        hops: [
          {
            from: 'TSM',
            to: 'NVDA',
            type: 'supplier_of',
            weight: 0.8,
            relationshipId: TSM_SUPPLIES_NVDA_ID,
          },
        ],
      },
    },
  ],
  // A direct holding scores 1.
  B: [
    {
      ...itemBase,
      _id: '6c1d2e3f-4a5b-4c6d-8e7f-8a9b0c1d2e02',
      userId: userId('B'),
      relevance: 1,
      path: { eventCompany: 'TSM', named: true, holding: 'TSM', hops: [] },
    },
  ],
  // No path within two hops.
  C: [
    {
      ...itemBase,
      _id: '6c1d2e3f-4a5b-4c6d-8e7f-8a9b0c1d2e03',
      userId: userId('C'),
      relevance: 0,
      path: null,
    },
  ],
};

// Spike check 3: the headline came after hours, so the base is the previous regular close.
export const DEMO_PRICE_REACTION: PriceReaction = {
  anchor: {
    kind: 'previous_close',
    baseAt: new Date('2024-04-02T19:59:00Z'),
    tradingDay: new Date('2024-04-03T12:00:00Z'),
  },
  windows: ['Open gap', '15 min after open', '2 h after open', 'Session close'],
  rows: [
    { symbol: 'TSM', moves: [-1.16, -0.38, 1.31, 1.25] },
    { symbol: 'NVDA', moves: [-1.07, -0.9, 0.86, -0.54] },
    { symbol: 'SMH', moves: [-1.0, -0.68, 0.96, 0.4] },
    { symbol: 'SPY', moves: [-0.22, -0.07, 0.4, 0.1] },
  ],
  delayNote: 'SIP data, delayed 15 minutes',
};
