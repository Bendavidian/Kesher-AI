import type {
  Company,
  Confidence,
  FeedItem,
  Importance,
  MarketEvent,
  Relationship,
  Tier,
  UniverseSymbol,
} from '@kesher/shared';
import { SHORT_NAME } from './companies';
import { formatDay } from './format';
import { buildPathView, type PathView } from './path';
import type { FilingView, NewsSourceView, Persona, PriceReaction } from './types';

export type RelevanceBand = 'High' | 'Medium' | 'None';

// Display bands for the code computed relevance. SPEC.md labels evals high, medium or none;
// T05 owns the thresholds and may move these.
export function relevanceBand(relevance: number): RelevanceBand {
  if (relevance === 0) return 'None';
  return relevance >= 0.8 ? 'High' : 'Medium';
}

export const TIER_LABEL: Record<Tier, string> = {
  1: 'Tier 1 primary',
  2: 'Tier 2 wire',
  3: 'Tier 3 social',
};

// The SPEC.md importance rubric levels.
export const IMPORTANCE_LABEL: Record<Importance, string> = {
  1: 'Routine',
  2: 'Low',
  3: 'Meaningful',
  4: 'Important',
  5: 'Major',
};

export const CONFIDENCE_LABEL: Record<Confidence, string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

// Templates for the SPEC.md confidence rule.
export const CONFIDENCE_NOTE: Record<Confidence, string> = {
  high: 'A primary source or two independent wires.',
  medium: 'One wire source so far.',
  low: 'Social sources only.',
};

export interface EvidenceView {
  quote: string;
  filingLabel: string;
  tier: Tier;
  reviewed: boolean;
  url: string;
}

export interface FeedEntry {
  item: FeedItem;
  event: MarketEvent;
  path: PathView;
  replayed: boolean;
}

export interface FixtureStore {
  events: MarketEvent[];
  newsSources: NewsSourceView[];
  companies: Company[];
  relationships: Relationship[];
  filings: FilingView[];
  feedItems: FeedItem[];
  priceReaction: PriceReaction;
  replayedEventId: string;
}

export interface EventView extends FeedEntry {
  source: NewsSourceView;
  evidence: EvidenceView[];
  relevanceNote: string;
  held: UniverseSymbol[];
}

export interface FeedView {
  visible: FeedEntry[];
  hidden: FeedEntry[];
  selected: EventView | null;
}

function eventCompany(event: MarketEvent, item: FeedItem): UniverseSymbol | null {
  if (item.path) return item.path.eventCompany;
  const symbol = event.extraction?.companies[0]?.symbol;
  return symbol && symbol in SHORT_NAME ? (symbol as UniverseSymbol) : null;
}

function relevanceNote(item: FeedItem): string {
  const band = relevanceBand(item.relevance);
  if (!item.path) return `${band}. No path to your holdings.`;
  if (item.path.hops.length === 0) return `${band}. You hold the company.`;
  return `${band}. Measured along the path.`;
}

function evidenceFor(item: FeedItem, store: FixtureStore): EvidenceView[] {
  return (item.path?.hops ?? []).flatMap((hop) => {
    const edge = store.relationships.find((r) => r._id === hop.relationshipId);
    // No evidence, no edge: a hop without a reviewed relationship is never shown as backed.
    if (!edge?.evidence.reviewed) return [];
    const filing = store.filings.find((f) => f.sourceId === edge.evidence.sourceId);
    if (!filing) return [];
    return [
      {
        quote: edge.evidence.quote,
        filingLabel: `${SHORT_NAME[filing.company]} ${filing.form}, filed ${formatDay(edge.evidence.filingDate)}`,
        tier: filing.tier,
        reviewed: edge.evidence.reviewed,
        url: edge.evidence.url,
      },
    ];
  });
}

export function buildFeedView(
  persona: Persona,
  store: FixtureStore,
  selectedEventId: string | null,
): FeedView {
  const entries = store.feedItems
    .filter((item) => item.userId === persona._id)
    .flatMap((item): FeedEntry[] => {
      const event = store.events.find((e) => e._id === item.eventId);
      const company = event ? eventCompany(event, item) : null;
      if (!event || !company) return [];
      return [
        {
          item,
          event,
          path: buildPathView(item.path, company, persona),
          replayed: event._id === store.replayedEventId,
        },
      ];
    })
    .sort((a, b) => b.event.publishedAt.getTime() - a.event.publishedAt.getTime());

  const visible = entries.filter((entry) => entry.item.relevance > 0);
  const hidden = entries.filter((entry) => entry.item.relevance === 0);

  const chosen =
    entries.find((entry) => entry.event._id === selectedEventId) ??
    entries.find((entry) => entry.replayed) ??
    entries[0];
  const source = chosen && store.newsSources.find((s) => s._id === chosen.event.sourceIds[0]);

  return {
    visible,
    hidden,
    selected:
      chosen && source
        ? {
            ...chosen,
            source,
            evidence: evidenceFor(chosen.item, store),
            relevanceNote: relevanceNote(chosen.item),
            held: persona.holdings.map((holding) => holding.symbol),
          }
        : null,
  };
}
