import {
  Company,
  FeedCard,
  FeedCardEvent,
  type FeedCardSource,
  FeedItem,
  type FeedPath,
  Relationship,
  Source,
  UniverseSymbol,
  type FeedEvidence,
} from '@kesher/shared';
import type { Db } from 'mongodb';
import { collection } from '../db/collections';

export const FEED_PAGE_SIZE = 50;

// The source fields a card carries. The body text stays on the server: it is untrusted data.
const cardSource = (source: Source): FeedCardSource => ({
  _id: source._id,
  provider: source.provider,
  kind: source.kind,
  tier: source.tier,
  externalId: source.externalId,
  url: source.url,
  publisher: source.publisher,
  title: source.title,
  publishedAt: source.publishedAt,
  injectionScreen: source.injectionScreen,
});

const byId = <T extends { _id: string }>(docs: T[]) => new Map(docs.map((doc) => [doc._id, doc]));

// What a card shows beside its FeedItem: the event, its first source and the evidence per hop.
export interface CardParts {
  event: FeedCardEvent;
  source: FeedCardSource;
  evidence: FeedEvidence[];
}

interface PathOf {
  eventId: string;
  path: FeedPath | null;
}

// Loads the parts for each entry, in order; null where the event or its source is gone. Every read
// is batched: one query per collection, whatever the number of entries. Code only.
export async function assembleParts(
  db: Db,
  entries: readonly PathOf[],
): Promise<(CardParts | null)[]> {
  if (entries.length === 0) return [];

  const events = byId(
    (
      await collection(db, 'market_events')
        .find({ _id: { $in: entries.map((entry) => entry.eventId) } })
        .project({ embedding: 0 })
        .toArray()
    ).map((doc) => FeedCardEvent.parse(doc)),
  );
  // The first source of the cluster is the one a card shows.
  const newsIds = [...events.values()].flatMap((event) => event.sourceIds.slice(0, 1));
  const hopIds = entries.flatMap(
    (entry) => entry.path?.hops.map((hop) => hop.relationshipId) ?? [],
  );
  const edges = byId(
    (
      await collection(db, 'relationships')
        .find({ _id: { $in: hopIds } })
        .toArray()
    ).map((doc) => Relationship.parse(doc)),
  );
  const filingIds = [...edges.values()].map((edge) => edge.evidence.sourceId);
  const sources = byId(
    (
      await collection(db, 'sources')
        .find({ _id: { $in: [...newsIds, ...filingIds] } })
        .toArray()
    ).map((doc) => Source.parse(doc)),
  );
  // A filing's first symbol is its filer.
  const filerOf = (source: Source | undefined) => UniverseSymbol.safeParse(source?.symbols[0]).data;
  const filers = [...sources.values()].flatMap((source) => {
    const filer = source.kind === 'filing' ? filerOf(source) : undefined;
    return filer ? [filer] : [];
  });
  const companies = new Map(
    (
      await collection(db, 'companies')
        .find({ symbol: { $in: filers } })
        .toArray()
    ).map((doc) => {
      const company = Company.parse(doc);
      return [company.symbol, company] as const;
    }),
  );

  // No evidence, no edge: a hop whose edge is gone, unreviewed or without its filing shows none.
  const evidenceFor = (path: FeedPath | null): FeedEvidence[] =>
    (path?.hops ?? []).flatMap((hop) => {
      const edge = edges.get(hop.relationshipId);
      if (!edge?.evidence.reviewed) return [];
      const filing = sources.get(edge.evidence.sourceId);
      const filer = filerOf(filing);
      const company = filer && companies.get(filer);
      if (!filing || !company) return [];
      return [
        {
          relationshipId: edge._id,
          from: edge.from,
          to: edge.to,
          type: edge.type,
          quote: edge.evidence.quote,
          filingDate: edge.evidence.filingDate,
          url: edge.evidence.url,
          reviewed: true,
          // The filer's annual form: every seeded edge quotes the filer's 10-K.
          filing: {
            sourceId: filing._id,
            symbol: company.symbol,
            title: filing.title,
            form: company.filerType,
            tier: filing.tier,
          },
        },
      ];
    });

  return entries.map((entry) => {
    const event = events.get(entry.eventId);
    const source = event && sources.get(event.sourceIds[0]!);
    if (!event || !source) return null;
    return { event, source: cardSource(source), evidence: evidenceFor(entry.path) };
  });
}

// Assembles FeedCards (docs/INTERFACES.md) from stored documents, in the order of the items.
export async function assembleCards(db: Db, items: readonly FeedItem[]): Promise<FeedCard[]> {
  const parts = await assembleParts(db, items);
  return items.flatMap((item, index) => {
    const part = parts[index];
    return part ? [FeedCard.parse({ item, ...part, priceReaction: null })] : [];
  });
}

// One card, for feed:item and feed:update (T06). null when its event or source is gone.
export async function feedCard(db: Db, item: FeedItem): Promise<FeedCard | null> {
  const [card] = await assembleCards(db, [item]);
  return card ?? null;
}

// The user's feed, newest item first. Relevance 0 never appears in a feed list (SPEC.md decision
// log, T05): those items only mark the event scored for that user, and GET /events/:eventId/explain
// shows why. The user id comes from the auth context only (GET /feed), never from a request argument.
export async function feedCardsFor(
  db: Db,
  userId: string,
  { limit = FEED_PAGE_SIZE }: { limit?: number } = {},
): Promise<FeedCard[]> {
  const items = await collection(db, 'feed_items')
    .find({ userId, relevance: { $gt: 0 } })
    .sort({ createdAt: -1, _id: 1 })
    .limit(limit)
    .toArray();
  return assembleCards(
    db,
    items.map((doc) => FeedItem.parse(doc)),
  );
}
