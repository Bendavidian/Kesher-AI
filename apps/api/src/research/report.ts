import { ReportDetail, type ReportSource, type Source } from '@kesher/shared';
import type { Db } from 'mongodb';
import { collection } from '../db/collections';
import { feedCard, type CardMarket } from '../feed/cards';

const PROVIDER_LABEL: Record<Source['provider'], string> = {
  alpaca: 'Alpaca',
  sec_edgar: 'SEC EDGAR',
};

// How a report names a source, built by code from the stored fields. The Source body text is
// not part of it.
export function reportSourceFor(source: Omit<Source, 'text'>): ReportSource {
  const provider = PROVIDER_LABEL[source.provider];
  if (source.kind === 'news') {
    const outlet = source.publisher ?? provider;
    return {
      _id: source._id,
      kind: source.kind,
      tier: source.tier,
      title: source.publisher ? `${source.publisher} via ${provider}` : provider,
      citeLabel: `${outlet} headline`,
      ref: `id ${source.externalId}`,
    };
  }
  return {
    _id: source._id,
    kind: source.kind,
    tier: source.tier,
    title: source.title,
    citeLabel: source.title,
    ref: source.externalId,
  };
}

// GET /reports/:reportId for the signed in user. null when the report does not exist or its run
// belongs to another user, so the answer never tells one from the other.
export async function reportDetail(
  db: Db,
  userId: string,
  reportId: string,
  market?: CardMarket,
): Promise<ReportDetail | null> {
  const report = await collection(db, 'reports').findOne({ _id: reportId });
  const run = report && (await collection(db, 'agent_runs').findOne({ _id: report.runId, userId }));
  if (!report || !run) return null;

  const claims = await collection(db, 'claims').find({ reportId }).toArray();
  const cited = [...new Set(claims.flatMap((claim) => claim.sources.map((s) => s.sourceId)))];
  const [sources, item] = await Promise.all([
    collection(db, 'sources')
      .find({ _id: { $in: cited } }, { projection: { text: 0 } })
      .toArray(),
    collection(db, 'feed_items').findOne({ userId, eventId: run.eventId }),
  ]);
  const card = item && item.relevance > 0 ? await feedCard(db, item, market) : null;
  const byId = new Map(sources.map((source) => [source._id, reportSourceFor(source)]));

  return ReportDetail.parse({
    report,
    claims,
    // In order of first citation.
    sources: cited.flatMap((id) => byId.get(id) ?? []),
    run,
    card,
  });
}
