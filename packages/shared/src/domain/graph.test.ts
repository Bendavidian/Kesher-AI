import { describe, expect, it } from 'vitest';
import {
  Company,
  EDGE_WEIGHTS,
  INVERSE_TYPE,
  RELATIONSHIP_TYPES,
  Relationship,
  withInverse,
} from './graph';

const evidence = {
  sourceId: '6f1c2c43-3a53-4d4e-9d7a-1d3c1f0f5b11',
  quote:
    'We utilize foundries, such as Taiwan Semiconductor Manufacturing Company Limited, or TSMC, and Samsung Electronics Co., Ltd., or Samsung, to produce our semiconductor wafers.',
  filingDate: '2026-02-25',
  url: 'https://www.sec.gov/Archives/edgar/data/1045810/000104581026000021/nvda-20260125.htm',
  reviewed: true,
};

const edge = {
  _id: '0b8c3f7e-2f4a-4a51-8d0e-2a4f5c6d7e81',
  from: 'TSM',
  to: 'NVDA',
  type: 'supplier_of',
  weight: 0.8,
  evidence,
  createdAt: new Date('2026-09-28T00:00:00Z'),
} as const;

describe('INVERSE_TYPE', () => {
  it('maps every type back to itself when applied twice', () => {
    for (const type of RELATIONSHIP_TYPES) {
      expect(INVERSE_TYPE[INVERSE_TYPE[type]]).toBe(type);
    }
  });

  it('pairs supplier_of with customer_of and keeps competitor_of symmetric', () => {
    expect(INVERSE_TYPE.supplier_of).toBe('customer_of');
    expect(INVERSE_TYPE.competitor_of).toBe('competitor_of');
  });

  it('gives both directions of a pair the same weight', () => {
    for (const type of RELATIONSHIP_TYPES) {
      expect(EDGE_WEIGHTS[INVERSE_TYPE[type]]).toBe(EDGE_WEIGHTS[type]);
    }
  });
});

describe('withInverse', () => {
  it('swaps the ends, inverts the type and keeps weight and evidence', () => {
    const [forward, inverse] = withInverse({
      from: 'TSM',
      to: 'NVDA',
      type: 'supplier_of',
      weight: 0.8,
      evidence,
    });

    expect(forward).toEqual({
      from: 'TSM',
      to: 'NVDA',
      type: 'supplier_of',
      weight: 0.8,
      evidence,
    });
    expect(inverse).toEqual({
      from: 'NVDA',
      to: 'TSM',
      type: 'customer_of',
      weight: 0.8,
      evidence,
    });
  });

  it('keeps competitor_of as competitor_of', () => {
    const [, inverse] = withInverse({ from: 'AMD', to: 'NVDA', type: 'competitor_of' });
    expect(inverse).toEqual({ from: 'NVDA', to: 'AMD', type: 'competitor_of' });
  });
});

describe('Relationship', () => {
  it('accepts an edge with reviewed filing evidence', () => {
    expect(Relationship.parse(edge)).toEqual(edge);
  });

  it('rejects an edge without evidence', () => {
    expect(Relationship.safeParse({ ...edge, evidence: undefined }).success).toBe(false);
  });

  it('rejects an empty or blank quote', () => {
    for (const quote of ['', '   ']) {
      expect(Relationship.safeParse({ ...edge, evidence: { ...evidence, quote } }).success).toBe(
        false,
      );
    }
  });

  it('rejects a non http evidence url', () => {
    const url = 'javascript:alert(1)';
    expect(Relationship.safeParse({ ...edge, evidence: { ...evidence, url } }).success).toBe(false);
  });

  it('rejects a self loop and a company outside the universe', () => {
    expect(Relationship.safeParse({ ...edge, to: 'TSM' }).success).toBe(false);
    expect(Relationship.safeParse({ ...edge, to: 'AAPL' }).success).toBe(false);
  });

  it('rejects types that T02 does not store', () => {
    expect(Relationship.safeParse({ ...edge, type: 'holds' }).success).toBe(false);
    expect(Relationship.safeParse({ ...edge, type: 'in_sector' }).success).toBe(false);
  });
});

describe('Company', () => {
  const company = {
    _id: '3d6b0c8e-1f2a-4b3c-9d4e-5f6a7b8c9d01',
    symbol: 'TSM',
    primaryListing: '2330.TW',
    name: 'Taiwan Semiconductor Manufacturing Co Ltd',
    cik: '0001046179',
    filerType: '20-F',
    sector: 'semiconductors',
    themes: ['foundry'],
    createdAt: new Date('2026-09-28T00:00:00Z'),
  } as const;

  it('keeps primaryListing next to the US symbol', () => {
    expect(Company.parse(company).primaryListing).toBe('2330.TW');
  });

  it('requires a 10 digit CIK', () => {
    expect(Company.safeParse({ ...company, cik: '1046179' }).success).toBe(false);
  });

  it('rejects unknown keys', () => {
    expect(Company.safeParse({ ...company, ticker: 'TSM' }).success).toBe(false);
  });
});
