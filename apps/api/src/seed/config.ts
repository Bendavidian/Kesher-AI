import type { Company, Holding, RelationshipType, Source, Theme, User } from '@kesher/shared';

// The pinned demo item (SPEC.md Replay and recording). An Alpaca news id, not a Source._id;
// T03 replays it by id, never by keyword.
export const DEMO_SOURCE_PROVIDER = 'alpaca';
export const DEMO_SOURCE_ID = '38062166';

// Public on purpose: the persona switcher is a demo control over seeded users, not
// authentication (docs/UI.md). Only its scrypt hash is stored.
export const DEMO_PASSWORD = 'kesher-demo';

export interface PersonaSeed {
  email: User['email'];
  displayName: string;
  holdings: Holding[];
  interests: Theme[];
}

// SPEC.md: A holds NVDA, MSFT, AMZN; B holds AMD, AVGO, TSM, ASML; C holds KO, JNJ, XOM.
export const PERSONAS: PersonaSeed[] = [
  {
    email: 'persona.a@kesher.example',
    displayName: 'Persona A, AI investor',
    holdings: [
      { symbol: 'NVDA', quantity: 100 },
      { symbol: 'MSFT', quantity: 40 },
      { symbol: 'AMZN', quantity: 60 },
    ],
    interests: ['ai_accelerators', 'cloud', 'data_centers'],
  },
  {
    email: 'persona.b@kesher.example',
    displayName: 'Persona B, semiconductor investor',
    holdings: [
      { symbol: 'AMD', quantity: 120 },
      { symbol: 'AVGO', quantity: 30 },
      { symbol: 'TSM', quantity: 80 },
      { symbol: 'ASML', quantity: 15 },
    ],
    interests: ['chip_design', 'foundry', 'semicap_equipment'],
  },
  {
    email: 'persona.c@kesher.example',
    displayName: 'Persona C, unrelated investor',
    holdings: [
      { symbol: 'KO', quantity: 200 },
      { symbol: 'JNJ', quantity: 90 },
      { symbol: 'XOM', quantity: 110 },
    ],
    interests: ['consumer_staples', 'pharma', 'oil_gas'],
  },
];

export type CompanySeed = Omit<Company, '_id' | 'createdAt'>;

// Checked on 28 Sep 2026: CIKs against SEC company_tickers.json; name, primaryListing and
// sector (finnhubIndustry) against Finnhub profile2. Themes are assigned by hand from the SPEC.md
// taxonomy. T11 takes over these fields from the Finnhub job.
export const COMPANIES: CompanySeed[] = [
  {
    symbol: 'NVDA',
    primaryListing: 'NVDA',
    name: 'NVIDIA Corp',
    cik: '0001045810',
    filerType: '10-K',
    sector: 'semiconductors',
    themes: ['ai_accelerators', 'chip_design', 'data_centers'],
  },
  {
    symbol: 'MSFT',
    primaryListing: 'MSFT',
    name: 'Microsoft Corp',
    cik: '0000789019',
    filerType: '10-K',
    sector: 'technology',
    themes: ['cloud', 'data_centers'],
  },
  {
    symbol: 'AMZN',
    primaryListing: 'AMZN',
    name: 'Amazon.com Inc',
    cik: '0001018724',
    filerType: '10-K',
    sector: 'retail',
    themes: ['cloud', 'data_centers'],
  },
  {
    symbol: 'GOOGL',
    primaryListing: 'GOOGL',
    name: 'Alphabet Inc',
    cik: '0001652044',
    filerType: '10-K',
    sector: 'media',
    themes: ['cloud', 'data_centers'],
  },
  {
    symbol: 'META',
    primaryListing: 'META',
    name: 'Meta Platforms Inc',
    cik: '0001326801',
    filerType: '10-K',
    sector: 'media',
    themes: ['data_centers'],
  },
  {
    symbol: 'AMD',
    primaryListing: 'AMD',
    name: 'Advanced Micro Devices Inc',
    cik: '0000002488',
    filerType: '10-K',
    sector: 'semiconductors',
    themes: ['ai_accelerators', 'chip_design', 'pc'],
  },
  {
    symbol: 'AVGO',
    primaryListing: 'AVGO',
    name: 'Broadcom Inc',
    cik: '0001730168',
    filerType: '10-K',
    sector: 'semiconductors',
    themes: ['ai_accelerators', 'chip_design', 'networking'],
  },
  {
    symbol: 'INTC',
    primaryListing: 'INTC',
    name: 'Intel Corp',
    cik: '0000050863',
    filerType: '10-K',
    sector: 'semiconductors',
    themes: ['chip_design', 'foundry', 'pc'],
  },
  {
    symbol: 'QCOM',
    primaryListing: 'QCOM',
    name: 'Qualcomm Inc',
    cik: '0000804328',
    filerType: '10-K',
    sector: 'semiconductors',
    themes: ['chip_design', 'smartphones'],
  },
  {
    symbol: 'MU',
    primaryListing: 'MU',
    name: 'Micron Technology Inc',
    cik: '0000723125',
    filerType: '10-K',
    sector: 'semiconductors',
    themes: ['memory'],
  },
  {
    symbol: 'TSM',
    primaryListing: '2330.TW',
    name: 'Taiwan Semiconductor Manufacturing Co Ltd',
    cik: '0001046179',
    filerType: '20-F',
    sector: 'semiconductors',
    themes: ['foundry'],
  },
  {
    symbol: 'ASML',
    primaryListing: 'ASML.AS',
    name: 'ASML Holding NV',
    cik: '0000937966',
    filerType: '20-F',
    sector: 'semiconductors',
    themes: ['semicap_equipment'],
  },
  {
    symbol: 'AMAT',
    primaryListing: 'AMAT',
    name: 'Applied Materials Inc',
    cik: '0000006951',
    filerType: '10-K',
    sector: 'semiconductors',
    themes: ['semicap_equipment'],
  },
  {
    symbol: 'LRCX',
    primaryListing: 'LRCX',
    name: 'Lam Research Corp',
    cik: '0000707549',
    filerType: '10-K',
    sector: 'semiconductors',
    themes: ['semicap_equipment'],
  },
  {
    symbol: 'KO',
    primaryListing: 'KO',
    name: 'Coca-Cola Co',
    cik: '0000021344',
    filerType: '10-K',
    sector: 'beverages',
    themes: ['consumer_staples'],
  },
  {
    symbol: 'JNJ',
    primaryListing: 'JNJ',
    name: 'Johnson & Johnson',
    cik: '0000200406',
    filerType: '10-K',
    sector: 'pharmaceuticals',
    themes: ['pharma', 'healthcare'],
  },
  {
    // SEC now maps XOM to the ExxonMobil Holdings Corp CIK (the old one is 0000034088).
    symbol: 'XOM',
    primaryListing: 'XOM',
    name: 'Exxonmobil Holdings Corp',
    cik: '0002115436',
    filerType: '10-K',
    sector: 'energy',
    themes: ['oil_gas', 'energy'],
  },
];

export interface FilingSeed {
  // The official EDGAR filing date, used as evidence.filingDate.
  filingDate: string;
  source: Omit<Source, '_id' | 'createdAt'>;
}

const filing = (
  symbol: string,
  company: string,
  accession: string,
  document: string,
  cik: number,
  filingDate: string,
  acceptedAt: string,
  period: string,
): FilingSeed => ({
  filingDate,
  source: {
    provider: 'sec_edgar',
    kind: 'filing',
    tier: 1,
    externalId: accession,
    url: `https://www.sec.gov/Archives/edgar/data/${cik}/${accession.replaceAll('-', '')}/${document}`,
    author: null,
    title: `${company} 10-K for the fiscal year ended ${period}`,
    symbols: [symbol],
    publishedAt: new Date(acceptedAt),
    // Seeded filings are reviewed by hand, not screened; the pipeline screens what it ingests.
    injectionScreen: null,
  },
});

// The 10-K filings behind the seeded edges. publishedAt is the EDGAR acceptance time.
export const FILINGS = {
  NVDA: filing(
    'NVDA',
    'NVIDIA Corp',
    '0001045810-26-000021',
    'nvda-20260125.htm',
    1045810,
    '2026-02-25',
    '2026-02-25T21:42:19Z',
    '2026-01-25',
  ),
  AMD: filing(
    'AMD',
    'Advanced Micro Devices Inc',
    '0000002488-26-000018',
    'amd-20251227.htm',
    2488,
    '2026-02-04',
    '2026-02-03T23:14:52Z',
    '2025-12-27',
  ),
  AVGO: filing(
    'AVGO',
    'Broadcom Inc',
    '0001730168-25-000121',
    'avgo-20251102.htm',
    1730168,
    '2025-12-18',
    '2025-12-18T21:04:47Z',
    '2025-11-02',
  ),
  LRCX: filing(
    'LRCX',
    'Lam Research Corp',
    '0000707549-26-000037',
    'lrcx-20260628.htm',
    707549,
    '2026-08-07',
    '2026-08-07T20:06:32Z',
    '2026-06-28',
  ),
} satisfies Record<string, FilingSeed>;

export interface EdgeSeed {
  from: CompanySeed['symbol'];
  to: CompanySeed['symbol'];
  type: RelationshipType;
  filing: keyof typeof FILINGS;
  quote: string;
}

// Hand written edges, reviewed by the user on 28 Sep 2026. Each quote is verbatim from the
// filing text after spike/checks/01-sec.ts htmlToText: tags stripped, entities decoded, and
// whitespace, including NBSP, collapsed to single spaces. Each is stored with its inverse.
export const EDGES: EdgeSeed[] = [
  {
    from: 'TSM',
    to: 'NVDA',
    type: 'supplier_of',
    filing: 'NVDA',
    quote:
      'We utilize foundries, such as Taiwan Semiconductor Manufacturing Company Limited, or TSMC, and Samsung Electronics Co., Ltd., or Samsung, to produce our semiconductor wafers.',
  },
  {
    from: 'AMD',
    to: 'NVDA',
    type: 'competitor_of',
    filing: 'NVDA',
    quote:
      'Our current competitors include: • suppliers and licensors of hardware and software for discrete and integrated GPUs, custom chips and other accelerated computing solutions, including solutions offered for AI, such as Advanced Micro Devices, Inc., or AMD',
  },
  {
    from: 'TSM',
    to: 'AMD',
    type: 'supplier_of',
    filing: 'AMD',
    quote:
      'We rely on Taiwan Semiconductor Manufacturing Company Limited (TSMC) for the production of all wafers for microprocessor and GPU products at 7 nanometer (nm) or smaller nodes',
  },
  {
    from: 'TSM',
    to: 'AVGO',
    type: 'supplier_of',
    filing: 'AVGO',
    quote:
      'During fiscal year 2025, approximately 95% of the wafers manufactured by our CMs were produced by TSMC.',
  },
  {
    from: 'INTC',
    to: 'AMD',
    type: 'competitor_of',
    filing: 'AMD',
    quote: 'Our primary competitor in the supply of CPUs and APUs is Intel.',
  },
  {
    from: 'LRCX',
    to: 'TSM',
    type: 'supplier_of',
    filing: 'LRCX',
    quote:
      'Our most significant customers during the fiscal years ending June 28, 2026, June 29, 2025, and June 30, 2024 included Micron Technology, Inc., Samsung Electronics Company, Ltd., SK hynix Inc., and Taiwan Semiconductor Manufacturing Company.',
  },
];
