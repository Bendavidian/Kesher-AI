import type { UniverseSymbol } from '@kesher/shared';
import { COMPANIES } from '../seed/config';
import type { AnnualForm } from './sec';
import type { Layout } from './sections';

// Every universe company as a filer: the CIKs and form come from the seed, which owns them
// (SPEC.md decision log, T11). The names each company goes by in filings and the section layouts
// come from docs/research/edge-candidates.md (research/edges/universe.ts).

export interface Filer {
  symbol: UniverseSymbol;
  form: AnnualForm;
  // Tried in order; the first with an annual report of this form wins.
  ciks: string[];
  // Case sensitive, matched on word boundaries. Each alias designates the company itself, or a
  // wholly owned business that filings name in its place (AWS for Amazon, Google for Alphabet).
  aliases: string[];
  // Names that contain an alias but designate a different company.
  exclude?: RegExp;
  layout: Layout;
}

interface FilerExtra {
  aliases: string[];
  exclude?: RegExp;
  layout?: Layout;
  // CIKs to try after the seeded one.
  fallbackCiks?: string[];
}

const TEN_K: Layout = { kind: 'items10k' };
const TWENTY_F: Layout = { kind: 'items20f' };

const EXTRA: Record<UniverseSymbol, FilerExtra> = {
  NVDA: { aliases: ['NVIDIA', 'Nvidia', 'Mellanox'] },
  MSFT: { aliases: ['Microsoft', 'LinkedIn', 'Activision Blizzard'] },
  AMZN: { aliases: ['Amazon', 'AWS', 'Amazon Web Services'] },
  GOOGL: { aliases: ['Alphabet', 'Google'] },
  META: { aliases: ['Meta Platforms', 'Meta', 'Facebook'] },
  AMD: { aliases: ['AMD', 'Advanced Micro Devices', 'Xilinx'] },
  AVGO: { aliases: ['Broadcom', 'VMware'] },
  INTC: {
    aliases: ['Intel'],
    // Intel's 10-K does not follow the Item order. Per its cross-reference index, Item 1 is
    // "Overview" through the operating segment results (pages 3 to 24) and Item 1A is "Risk
    // Factors" (pages 37 to 51).
    layout: {
      kind: 'headings',
      sections: [
        { name: 'Item 1', start: /^Overview$/, end: /^Consolidated Results of Operations$/ },
        { name: 'Item 1A', start: /^Risk Factors$/, end: /^Other Key Information$/ },
      ],
    },
  },
  QCOM: { aliases: ['Qualcomm', 'QUALCOMM'] },
  MU: { aliases: ['Micron'] },
  TSM: { aliases: ['TSMC', 'Taiwan Semiconductor Manufacturing', 'Taiwan Semiconductor'] },
  ASML: {
    aliases: ['ASML'],
    // ASML files its annual report as the 20-F, converted from PDF: every page opens with
    // "ASML Annual Report 2025" and its page number. Per its "Reference table 20-F", Item 4.B is
    // "At a glance", "Our business" and "Our marketplace" (pages 6 to 53) and Note 2, revenue from
    // contracts with customers (pages 284 to 287); Item 3.D is "Risk factors" (pages 66 to 73).
    // The page numbers are specific to the report for 2025 and are checked on every run.
    layout: {
      kind: 'pages',
      marker: /^ASML Annual Report \d{4}$/,
      sections: [
        {
          name: 'Item 4',
          pages: [
            [6, 53],
            [284, 287],
          ],
        },
        { name: 'Item 3.D', pages: [[66, 73]] },
      ],
    },
  },
  AMAT: { aliases: ['Applied Materials'] },
  LRCX: { aliases: ['Lam Research'] },
  KO: {
    aliases: ['Coca-Cola'],
    // Independent bottlers carry the brand in their names.
    exclude: /Coca-Cola (FEMSA|Europacific|HBC|Consolidated|Bottling|İçecek|Icecek|Beverages)/g,
  },
  JNJ: { aliases: ['Johnson & Johnson', 'J&J'] },
  // SEC now maps XOM to the ExxonMobil Holdings Corp CIK, which may have no 10-K yet.
  XOM: { aliases: ['Exxon Mobil', 'ExxonMobil', 'Exxon'], fallbackCiks: ['0000034088'] },
};

export const FILERS: Filer[] = COMPANIES.map((company) => {
  const extra = EXTRA[company.symbol];
  return {
    symbol: company.symbol,
    form: company.filerType,
    ciks: [company.cik, ...(extra.fallbackCiks ?? [])],
    aliases: extra.aliases,
    exclude: extra.exclude,
    layout: extra.layout ?? (company.filerType === '20-F' ? TWENTY_F : TEN_K),
  };
});

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Longest alias first, so "Meta Platforms" wins over "Meta" in the reported match.
const MATCHERS = FILERS.map((filer) => ({
  filer,
  pattern: new RegExp(
    `(?<!\\w)(?:${[...filer.aliases]
      .sort((a, b) => b.length - a.length)
      .map(escape)
      .join('|')})(?!\\w)`,
  ),
}));

export interface Mention {
  symbol: UniverseSymbol;
  alias: string;
}

// Every universe company a sentence names, with the first alias that matched, in universe order.
export function mentions(sentence: string): Mention[] {
  const found: Mention[] = [];
  for (const { filer, pattern } of MATCHERS) {
    const cleaned = filer.exclude ? sentence.replace(filer.exclude, ' ') : sentence;
    const match = pattern.exec(cleaned);
    if (match?.[0]) found.push({ symbol: filer.symbol, alias: match[0] });
  }
  return found;
}
