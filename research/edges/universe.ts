import type { Layout } from './text';

// The demo universe from SPEC.md ("Demo universe and personas"), with the names each company
// goes by in filings. Benchmarks (SPY, SMH) are price only and have no relationships.

export type Ticker =
  | 'NVDA'
  | 'MSFT'
  | 'AMZN'
  | 'GOOGL'
  | 'META'
  | 'AMD'
  | 'AVGO'
  | 'INTC'
  | 'QCOM'
  | 'MU'
  | 'TSM'
  | 'ASML'
  | 'AMAT'
  | 'LRCX'
  | 'KO'
  | 'JNJ'
  | 'XOM';

export type Group = 'ai_cloud' | 'semis' | 'equipment' | 'unrelated';

export interface Company {
  symbol: Ticker;
  name: string;
  group: Group;
  cik: string;
  form: '10-K' | '20-F';
  // Case sensitive, matched on word boundaries. Each alias designates the company itself, or a
  // wholly owned business that filings name in its place (AWS for Amazon, Google for Alphabet).
  aliases: string[];
  // Names that contain an alias but designate a different company.
  exclude?: RegExp;
  layout?: Layout;
}

export const UNIVERSE: Company[] = [
  {
    symbol: 'NVDA',
    name: 'NVIDIA Corporation',
    group: 'ai_cloud',
    cik: '0001045810',
    form: '10-K',
    aliases: ['NVIDIA', 'Nvidia', 'Mellanox'],
  },
  {
    symbol: 'MSFT',
    name: 'Microsoft Corporation',
    group: 'ai_cloud',
    cik: '0000789019',
    form: '10-K',
    aliases: ['Microsoft', 'LinkedIn', 'Activision Blizzard'],
  },
  {
    symbol: 'AMZN',
    name: 'Amazon.com, Inc.',
    group: 'ai_cloud',
    cik: '0001018724',
    form: '10-K',
    aliases: ['Amazon', 'AWS', 'Amazon Web Services'],
  },
  {
    symbol: 'GOOGL',
    name: 'Alphabet Inc.',
    group: 'ai_cloud',
    cik: '0001652044',
    form: '10-K',
    aliases: ['Alphabet', 'Google'],
  },
  {
    symbol: 'META',
    name: 'Meta Platforms, Inc.',
    group: 'ai_cloud',
    cik: '0001326801',
    form: '10-K',
    aliases: ['Meta Platforms', 'Meta', 'Facebook'],
  },
  {
    symbol: 'AMD',
    name: 'Advanced Micro Devices, Inc.',
    group: 'semis',
    cik: '0000002488',
    form: '10-K',
    aliases: ['AMD', 'Advanced Micro Devices', 'Xilinx'],
  },
  {
    symbol: 'AVGO',
    name: 'Broadcom Inc.',
    group: 'semis',
    cik: '0001730168',
    form: '10-K',
    aliases: ['Broadcom', 'VMware'],
  },
  {
    symbol: 'INTC',
    name: 'Intel Corporation',
    group: 'semis',
    cik: '0000050863',
    form: '10-K',
    aliases: ['Intel'],
    // Per its cross-reference index, Item 1 is "Overview" through Operating Segment Results
    // (pages 3 to 24) and Item 1A is "Risk Factors" (pages 37 to 51).
    layout: {
      item1: [/^Overview$/, /^Consolidated Results of Operations$/],
      item1a: [/^Risk Factors$/, /^Other Key Information$/],
    },
  },
  {
    symbol: 'QCOM',
    name: 'QUALCOMM Incorporated',
    group: 'semis',
    cik: '0000804328',
    form: '10-K',
    aliases: ['Qualcomm', 'QUALCOMM'],
  },
  {
    symbol: 'MU',
    name: 'Micron Technology, Inc.',
    group: 'semis',
    cik: '0000723125',
    form: '10-K',
    aliases: ['Micron'],
  },
  {
    symbol: 'TSM',
    name: 'Taiwan Semiconductor Manufacturing Company Limited',
    group: 'equipment',
    cik: '0001046179',
    form: '20-F',
    aliases: ['TSMC', 'Taiwan Semiconductor Manufacturing', 'Taiwan Semiconductor'],
  },
  {
    symbol: 'ASML',
    name: 'ASML Holding N.V.',
    group: 'equipment',
    cik: '0000937966',
    form: '20-F',
    aliases: ['ASML'],
  },
  {
    symbol: 'AMAT',
    name: 'Applied Materials, Inc.',
    group: 'equipment',
    cik: '0000006951',
    form: '10-K',
    aliases: ['Applied Materials'],
  },
  {
    symbol: 'LRCX',
    name: 'Lam Research Corporation',
    group: 'equipment',
    cik: '0000707549',
    form: '10-K',
    aliases: ['Lam Research'],
  },
  {
    symbol: 'KO',
    name: 'The Coca-Cola Company',
    group: 'unrelated',
    cik: '0000021344',
    form: '10-K',
    aliases: ['Coca-Cola'],
    // Independent bottlers carry the brand in their names.
    exclude: /Coca-Cola (FEMSA|Europacific|HBC|Consolidated|Bottling|İçecek|Icecek|Beverages)/,
  },
  {
    symbol: 'JNJ',
    name: 'Johnson & Johnson',
    group: 'unrelated',
    cik: '0000200406',
    form: '10-K',
    aliases: ['Johnson & Johnson', 'J&J'],
  },
  {
    symbol: 'XOM',
    name: 'Exxon Mobil Corporation',
    group: 'unrelated',
    cik: '0000034088',
    form: '10-K',
    aliases: ['Exxon Mobil', 'ExxonMobil', 'Exxon'],
  },
];

export const BY_SYMBOL = new Map(UNIVERSE.map((c) => [c.symbol, c]));

export function company(symbol: Ticker): Company {
  const found = BY_SYMBOL.get(symbol);
  if (!found) throw new Error(`Unknown symbol ${symbol}`);
  return found;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Longest alias first, so "Meta Platforms" wins over "Meta" in the reported match.
const MATCHERS = UNIVERSE.map((c) => ({
  company: c,
  pattern: new RegExp(
    `(?<!\\w)(?:${[...c.aliases]
      .sort((a, b) => b.length - a.length)
      .map(escape)
      .join('|')})(?!\\w)`,
    'g',
  ),
}));

export interface Mention {
  symbol: Ticker;
  alias: string;
}

// Every universe company a sentence names, with the first alias that matched.
export function mentions(sentence: string): Mention[] {
  const found: Mention[] = [];
  for (const { company: c, pattern } of MATCHERS) {
    const cleaned = c.exclude ? sentence.replace(new RegExp(c.exclude, 'g'), ' ') : sentence;
    const match = cleaned.match(pattern);
    if (match?.[0]) found.push({ symbol: c.symbol, alias: match[0] });
  }
  return found;
}
