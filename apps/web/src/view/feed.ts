import {
  relevanceBand,
  SHORT_NAME,
  type Confidence,
  type FeedResearch,
  type FeedCard,
  type FeedCardEvent,
  type FeedCardSource,
  type FeedEvidence,
  type FeedPath,
  type HiddenFeed,
  type Importance,
  type RelevanceBand,
  type Tier,
  type UniverseSymbol,
} from '@kesher/shared';
import { formatDay } from './format';
import { buildPathView, type PathView } from './path';
import { priceReactionView } from './price';
import type { NewsSourceView, Persona, PriceReaction } from './types';

export type RelevanceLabel = 'High' | 'Medium' | 'None';

const BAND_LABEL: Record<RelevanceBand, RelevanceLabel> = {
  high: 'High',
  medium: 'Medium',
  none: 'None',
};

// The display label of the relevance band; the thresholds live in packages/shared.
export function relevanceLabel(relevance: number): RelevanceLabel {
  return BAND_LABEL[relevanceBand(relevance)];
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

// What code decided for this investor: from the FeedItem, or from the explanation of a hidden
// item, which no feed list carries.
export interface Score {
  relevance: number;
  path: FeedPath | null;
  confidence: Confidence;
}

export interface FeedEntry {
  // The FeedItem id, or the event id for an explained event with no FeedItem in the feed.
  key: string;
  score: Score;
  event: FeedCardEvent;
  path: PathView;
  // The event the last replay scored.
  replayed: boolean;
}

export interface EventView extends FeedEntry {
  source: NewsSourceView;
  evidence: EvidenceView[];
  relevanceNote: string;
  held: UniverseSymbol[];
  // The research on the user's FeedItem; null for an explained event, which has no FeedItem.
  research: FeedResearch | null;
  // From the card; null for an explained event, or when the api could not read market data.
  reaction: PriceReaction | null;
}

export interface FeedView {
  // Newest arrival first (SPEC.md decision log, T23).
  visible: FeedEntry[];
  // The most recent hidden items, newest arrival first, as GET /feed/hidden sent them.
  hidden: FeedEntry[];
  // Every hidden item of the user, the ones shown included.
  hiddenTotal: number;
  selected: EventView | null;
}

// What the feed screen shows: the user's FeedCards (relevance above 0, from GET /feed and the
// socket) and the most recent scored events that stay out of the feed (GET /feed/hidden).
export interface FeedInput {
  cards: readonly FeedCard[];
  hidden: HiddenFeed;
  replayedEventId: string | null;
}

function sourceView(source: FeedCardSource): NewsSourceView {
  return {
    _id: source._id,
    provider: source.provider,
    tier: source.tier,
    externalId: source.externalId,
    publishedAt: source.publishedAt,
    wire: source.publisher,
  };
}

function eventCompany(event: FeedCardEvent, path: FeedPath | null): UniverseSymbol | null {
  if (path) return path.eventCompany;
  // Without a path, the extracted company only names the first station. It is display only:
  // relevance and the path were already decided by code.
  const symbol = event.extraction?.companies[0]?.symbol;
  return symbol && symbol in SHORT_NAME ? (symbol as UniverseSymbol) : null;
}

function relevanceNote(score: Score): string {
  const band = relevanceLabel(score.relevance);
  if (!score.path) return `${band}. No path to your holdings.`;
  if (score.path.hops.length === 0) return `${band}. You hold the company.`;
  return `${band}. Measured along the path.`;
}

// The server sends only reviewed evidence (no evidence, no edge); this only labels it.
function evidenceView(evidence: FeedEvidence): EvidenceView {
  return {
    quote: evidence.quote,
    filingLabel: `${SHORT_NAME[evidence.filing.symbol]} ${evidence.filing.form}, filed ${formatDay(evidence.filingDate)}`,
    tier: evidence.filing.tier,
    reviewed: evidence.reviewed,
    url: evidence.url,
  };
}

interface Candidate {
  key: string;
  score: Score;
  event: FeedCardEvent;
  source: FeedCardSource;
  evidence: FeedEvidence[];
  research: FeedResearch | null;
  reaction: PriceReaction | null;
}

export function buildFeedView(
  persona: Persona,
  { cards, hidden: hiddenFeed, replayedEventId }: FeedInput,
  selectedEventId: string | null,
): FeedView {
  const carded = new Set(cards.map((card) => card.event._id));
  // By arrival, as GET /feed orders them: a replayed card is a new FeedItem, so it lands on top.
  const arrived = [...cards].sort(
    (a, b) =>
      b.item.createdAt.getTime() - a.item.createdAt.getTime() ||
      (a.item._id < b.item._id ? -1 : a.item._id > b.item._id ? 1 : 0),
  );
  const candidates: Candidate[] = [
    ...arrived.map((card) => ({
      key: card.item._id,
      score: card.item,
      event: card.event,
      source: card.source,
      evidence: card.evidence,
      research: card.item.research,
      reaction: card.priceReaction && priceReactionView(card.priceReaction),
    })),
    // A hidden item only fills in an event the feed does not carry.
    ...hiddenFeed.recent
      .filter((explain) => !carded.has(explain.event._id))
      .map((explain) => ({
        key: explain.event._id,
        score: explain,
        event: explain.event,
        source: explain.source,
        evidence: explain.evidence,
        research: null,
        reaction: null,
      })),
  ];

  const byKey = new Map(candidates.map((candidate) => [candidate.key, candidate]));
  const entries = candidates.flatMap((candidate): FeedEntry[] => {
    const company = eventCompany(candidate.event, candidate.score.path);
    if (!company) return [];
    return [
      {
        key: candidate.key,
        score: {
          relevance: candidate.score.relevance,
          path: candidate.score.path,
          confidence: candidate.score.confidence,
        },
        event: candidate.event,
        path: buildPathView(candidate.score.path, company, persona),
        replayed: candidate.event._id === replayedEventId,
      },
    ];
  });

  const visible = entries.filter((entry) => entry.score.relevance > 0);
  const hidden = entries.filter((entry) => entry.score.relevance === 0);

  const chosen =
    entries.find((entry) => entry.event._id === selectedEventId) ??
    entries.find((entry) => entry.replayed) ??
    visible[0] ??
    hidden[0];
  const candidate = chosen && byKey.get(chosen.key);

  return {
    visible,
    hidden,
    hiddenTotal: Math.max(hiddenFeed.total, hidden.length),
    selected:
      chosen && candidate
        ? {
            ...chosen,
            source: sourceView(candidate.source),
            evidence: candidate.evidence.map(evidenceView),
            relevanceNote: relevanceNote(chosen.score),
            held: persona.holdings.map((holding) => holding.symbol),
            research: candidate.research,
            reaction: candidate.reaction,
          }
        : null,
  };
}
