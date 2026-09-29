import { z } from 'zod';
import { Id, NonBlank, Tier } from './domain/common';
import { AgentRun, Claim, Report } from './domain/research';
import { SourceKind } from './domain/source';
import { FeedCard } from './feed';

// How a report names one source (docs/INTERFACES.md), built by code from the stored Source,
// without its body text.
export const ReportSource = z.strictObject({
  _id: Id,
  kind: SourceKind,
  tier: Tier,
  // The source as the sources panel lists it: Benzinga via Alpaca.
  title: NonBlank,
  // How a claim's evidence line names it: Benzinga headline.
  citeLabel: NonBlank,
  // The provider id or the accession number.
  ref: NonBlank,
});
export type ReportSource = z.infer<typeof ReportSource>;

// GET /reports/:reportId: one report of the signed in user with its claims, removed ones
// included, the sources those claims cite, the run that wrote it and the event's card. card is
// null when the FeedItem is gone, for example after a dev reset. The run carries its steps as the
// run screen shows them: tool output is redacted, capped at 8 KB and may quote untrusted excerpts,
// which the web renders as text only.
export const ReportDetail = z.strictObject({
  report: Report,
  claims: z.array(Claim),
  sources: z.array(ReportSource),
  run: AgentRun,
  card: FeedCard.nullable(),
});
export type ReportDetail = z.infer<typeof ReportDetail>;
