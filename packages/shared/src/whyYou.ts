import { onlyMentioned, type FeedPath } from './domain/event';
import type { RelationshipType } from './domain/graph';
import type { UniverseSymbol } from './domain/universe';

// "Why you" is rendered from the graph path with fixed templates, never by a model (CLAUDE.md,
// principle 3). Every sentence comes from the path and the user's holdings alone. The api and the
// web both render with these, so the wording is the same everywhere.

// Short names for prose and path stations. Company.name holds the legal name.
export const SHORT_NAME: Record<UniverseSymbol, string> = {
  NVDA: 'NVIDIA',
  MSFT: 'Microsoft',
  AMZN: 'Amazon',
  GOOGL: 'Alphabet',
  META: 'Meta',
  AMD: 'AMD',
  AVGO: 'Broadcom',
  INTC: 'Intel',
  QCOM: 'Qualcomm',
  MU: 'Micron',
  TSM: 'TSMC',
  ASML: 'ASML',
  AMAT: 'Applied Materials',
  LRCX: 'Lam Research',
  KO: 'Coca-Cola',
  JNJ: 'Johnson & Johnson',
  XOM: 'ExxonMobil',
};

// The verb for one hop, read from the hop's from company to its to company.
export const HOP_VERB: Record<RelationshipType, string> = {
  supplier_of: 'supplies',
  customer_of: 'buys from',
  competitor_of: 'competes with',
};

// NVDA, MSFT and AMZN
export function joinList(items: readonly string[], conjunction: 'and' | 'or' = 'and'): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} ${conjunction} ${items.at(-1) ?? ''}`;
}

export interface WhyYou {
  connected: boolean;
  // The sentence for the full path, and a short one for a feed row.
  label: string;
  rowLabel: string;
  // That the item only mentions the company the path starts from (T27); null when the extraction
  // names it, and when nothing connects.
  mention: string | null;
  // Why nothing connects; null when a path exists.
  explanation: string | null;
}

export function whyYou(
  path: FeedPath | null,
  eventCompany: UniverseSymbol,
  held: readonly UniverseSymbol[],
): WhyYou {
  const eventName = SHORT_NAME[eventCompany];

  if (!path) {
    return {
      connected: false,
      label: `No connection from ${eventName} to your holdings`,
      rowLabel: 'No path to your holdings',
      mention: null,
      explanation: `You hold ${joinList(held)}. Nothing in the graph links them to ${eventName} within two stops.`,
    };
  }

  const holdingName = SHORT_NAME[path.holding];
  const mentioned = onlyMentioned(path);
  const mention = mentioned ? `The item mentions ${eventName} only in passing.` : null;
  if (path.hops.length === 0) {
    return {
      connected: true,
      label: mentioned
        ? `You hold ${holdingName}, which the item mentions only in passing`
        : `You hold ${holdingName} directly`,
      rowLabel: mentioned
        ? `You hold ${holdingName}, mentioned in passing`
        : `You hold ${holdingName}`,
      mention,
      explanation: null,
    };
  }

  const clauses = path.hops
    .map((hop) => `${SHORT_NAME[hop.from]} ${HOP_VERB[hop.type]} ${SHORT_NAME[hop.to]}`)
    .join(', ');
  return {
    connected: true,
    label: mentioned
      ? `The item mentions ${eventName} only in passing; ${clauses}, and ${holdingName} is in your portfolio`
      : `${clauses}, and ${holdingName} is in your portfolio`,
    rowLabel: mentioned
      ? `Mentioned in passing: ${clauses}, which you hold`
      : `${clauses}, which you hold`,
    mention,
    explanation: null,
  };
}
