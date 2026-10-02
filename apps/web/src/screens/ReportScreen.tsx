import {
  SHORT_NAME,
  type Claim,
  type ClaimStatus,
  type PublicUser,
  type ReportDetail,
  type UniverseSymbol,
} from '@kesher/shared';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { ApiError } from '../api/client';
import { RingPath } from '../components/ConnectionPath';
import { CheckIcon } from '../components/EvidenceCard';
import { RelevancePill } from '../components/FeedList';
import { TIER_CHIP } from '../components/tierChip';
import { TopBar, ViewingAs } from '../components/TopBar';
import { useLiveDeps } from '../live/deps';
import { FEED_PATH, runPath } from '../routes';
import { TIER_LABEL } from '../view/feed';
import { buildPathView } from '../view/path';
import { personaFrom } from '../view/personas';
import {
  buildReportView,
  CLAIM_TYPE_LABEL,
  CLAIM_TYPE_NOTE,
  type ClaimRow,
  type NumberedSource,
} from '../view/report';
import { removingCheckStep } from '../view/run';
import { NotFoundScreen } from './NotFoundScreen';

// Fact supplier blue, metric code teal, inference model amber (docs/UI.md).
const TYPE_CHIP: Record<Claim['type'], string> = {
  fact: 'bg-supplier-tint text-supplier',
  metric: 'bg-code-tint text-code',
  inference: 'bg-model-tint text-model',
};

const SEGMENT: Record<ClaimStatus, string> = {
  supported: 'bg-up',
  unverified: 'bg-border-strong',
  removed: 'bg-down',
};

const CLAIM_GRID = 'grid grid-cols-[36px_96px_minmax(0,1fr)_150px]';

// A row chip is 3 by 8 px, a legend chip 2 by 8 (docs/design/report.dc.html).
function TypeChip({ type, testId }: { type: Claim['type']; testId?: string }) {
  const padding = testId === 'claim-type' ? 'py-[3px]' : 'py-0.5';
  return (
    <span
      data-testid={testId}
      className={`rounded-[5px] px-2 ${padding} text-[11px] font-extrabold ${TYPE_CHIP[type]}`}
    >
      {CLAIM_TYPE_LABEL[type]}
    </span>
  );
}

// Signed percentages in claim text take the up or down color (docs/UI.md, Type and shape).
function ColoredPercents({ text }: { text: string }) {
  return text.split(/([+−]\d+(?:\.\d+)?%)/).map((part, index) => {
    if (index % 2 === 0) return part;
    return (
      <span key={index} className={part.startsWith('+') ? 'text-up' : 'text-down'}>
        {part}
      </span>
    );
  });
}

function ClaimItem({ row }: { row: ClaimRow }) {
  const { claim, evidence, status } = row;
  return (
    <li className={`${CLAIM_GRID} items-start border-b border-divider px-[22px] py-[13px]`}>
      <span className="text-[13px] font-extrabold text-text-3 tabular-nums">{row.number}</span>
      <span>
        <TypeChip type={claim.type} testId="claim-type" />
      </span>
      <div className="flex flex-col gap-[5px]">
        <p className="text-sm leading-normal font-semibold">
          <ColoredPercents text={claim.text} />
        </p>
        <p className="text-xs leading-normal text-text-2">
          {evidence.markers.length > 0 && (
            <span className="font-extrabold text-text">
              {evidence.markers.map((n) => `[${n}]`).join('')}{' '}
            </span>
          )}
          {evidence.text}
        </p>
      </div>
      <span className="flex items-center justify-end gap-[5px] text-xs font-extrabold text-up">
        <CheckIcon size={14} />
        {status}
      </span>
    </li>
  );
}

function SourceChip({ source }: { source: NumberedSource }) {
  const [className, label] =
    source.kind === 'market_data'
      ? ['bg-code-tint text-code', 'Market data']
      : [TIER_CHIP[source.tier], TIER_LABEL[source.tier]];
  return (
    <span className={`rounded-[5px] px-[7px] py-0.5 font-extrabold ${className}`}>{label}</span>
  );
}

function RemovedIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true" className="mt-0.5 shrink-0">
      <circle cx="10" cy="10" r="8" className="fill-none stroke-down" strokeWidth="2" />
      <path
        d="M7 7 L13 13 M13 7 L7 13"
        className="fill-none stroke-down"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

type Load =
  | { status: 'loading' }
  | { status: 'missing' }
  | { status: 'error'; message: string }
  | { status: 'ready'; detail: ReportDetail; user: PublicUser | null };

// GET /reports/:reportId for the signed in user, and GET /me for whose connection it shows.
export function ReportScreen() {
  const { reportId = '' } = useParams();
  const { api } = useLiveDeps();
  const [load, setLoad] = useState<{ reportId: string } & Load>({ reportId, status: 'loading' });

  useEffect(() => {
    let active = true;
    const settle = (next: Load) => {
      if (active) setLoad({ reportId, ...next });
    };
    Promise.all([api.report(reportId), api.me().catch(() => null)]).then(
      ([detail, user]) => settle({ status: 'ready', detail, user }),
      (error: unknown) => {
        if (error instanceof ApiError && (error.status === 404 || error.status === 400)) {
          settle({ status: 'missing' });
        } else if (error instanceof ApiError && error.status === 401) {
          settle({ status: 'error', message: 'Sign in from the feed to see your reports.' });
        } else {
          settle({
            status: 'error',
            message: 'Could not load the report. Check that the api is running.',
          });
        }
      },
    );
    return () => {
      active = false;
    };
  }, [api, reportId]);

  const current: Load = load.reportId === reportId ? load : { status: 'loading' };
  if (current.status === 'missing') return <NotFoundScreen what="report" />;
  if (current.status !== 'ready') {
    return (
      <div className="flex min-h-screen flex-col">
        <TopBar current="feed">{null}</TopBar>
        <main className="flex flex-1 p-3">
          <p
            role={current.status === 'error' ? 'alert' : 'status'}
            className="h-fit rounded-panel border border-border bg-panel px-[22px] py-4 text-sm text-text-2"
          >
            {current.status === 'error' ? current.message : 'Loading the report.'}
          </p>
        </main>
      </div>
    );
  }
  return <ReportBody detail={current.detail} user={current.user} />;
}

function ReportBody({ detail, user }: { detail: ReportDetail; user: PublicUser | null }) {
  const { report, claims, run, sources, card } = detail;
  const view = buildReportView(report, claims, run, sources, card?.priceReaction?.anchor ?? null);
  const event = card?.event;
  const item = card?.item;
  const persona = user && personaFrom(user);
  const symbol = item?.path?.eventCompany ?? event?.extraction?.companies[0]?.symbol;
  const company = symbol && symbol in SHORT_NAME ? (symbol as UniverseSymbol) : null;
  const path = item && persona && company ? buildPathView(item.path, company, persona) : null;
  const checkStep = removingCheckStep(run, view.removedClaimIds[0]);
  const removedCount = view.removedReasons.length;

  return (
    <div className="flex min-h-screen flex-col xl:h-screen">
      <TopBar current="feed">{persona && <ViewingAs label={persona.switcherLabel} />}</TopBar>
      <div className="flex flex-1 flex-col gap-3 p-3 xl:min-h-0 xl:flex-row">
        <main className="flex flex-col overflow-hidden rounded-panel border border-border bg-panel xl:min-w-0 xl:flex-1">
          <div className="flex flex-col gap-2.5 border-b border-border px-[22px] pt-2.5 pb-4">
            <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-xs text-text-3">
              <Link
                to={FEED_PATH}
                className="inline-block py-3 font-bold text-supplier-light hover:underline"
              >
                Feed
              </Link>
              <span aria-hidden="true">/</span>
              <span className="max-w-[620px] truncate">{event?.headline}</span>
            </nav>
            <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
              {/* At most the row's width, so the chips wrap on a phone instead of running past the
                  panel (T29). */}
              <div className="flex max-w-full min-w-0 flex-col gap-2.5">
                <h1 className="text-[26px] leading-[1.2] font-extrabold">Research report</h1>
                <ul
                  aria-label="Report summary"
                  className="flex flex-wrap gap-2 text-xs font-extrabold tabular-nums"
                >
                  <li className="rounded-chip bg-border px-[9px] py-1 text-text-2">{view.mode}</li>
                  <li className="rounded-chip bg-supplier-tint px-[9px] py-1 text-supplier">
                    {view.toolCalls}
                  </li>
                  <li className="rounded-chip bg-up-tint px-[9px] py-1 text-up">
                    {view.counts.supported} supported
                  </li>
                  {view.counts.unverified > 0 && (
                    <li className="rounded-chip bg-border px-[9px] py-1 text-text-2">
                      {view.counts.unverified} not verified
                    </li>
                  )}
                  <li className="rounded-chip bg-down-tint px-[9px] py-1 text-down">
                    {view.counts.removed} removed
                  </li>
                </ul>
                <div
                  role="img"
                  aria-label={view.barLabel}
                  className="flex h-2 w-[420px] max-w-full gap-1"
                >
                  {view.bar.map((status, index) => (
                    <span key={index} className={`grow rounded-[3px] ${SEGMENT[status]}`} />
                  ))}
                </div>
              </div>
              <Link
                to={runPath(run._id)}
                className="flex h-11 shrink-0 items-center rounded-button border border-border-strong px-[18px] text-sm font-bold text-text hover:bg-raised focus-visible:outline-2 focus-visible:outline-you"
              >
                View agent run
              </Link>
            </div>
            <ul
              aria-label="Claim types"
              className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-3"
            >
              {(['fact', 'metric', 'inference'] as const).map((type) => (
                <li key={type} className="flex items-center gap-[7px]">
                  <TypeChip type={type} />
                  {CLAIM_TYPE_NOTE[type]}
                </li>
              ))}
            </ul>
          </div>

          <div
            aria-hidden="true"
            className={`${CLAIM_GRID} border-b border-divider px-[22px] py-2 text-[11px] font-bold text-text-3`}
          >
            <span>#</span>
            <span>Type</span>
            <span>Claim and evidence</span>
            <span className="text-right">Status</span>
          </div>

          <div className="flex flex-1 flex-col xl:min-h-0 xl:overflow-y-auto">
            <ol aria-label="Claims" className="flex flex-col">
              {view.rows.map((row) => (
                <ClaimItem key={row.claim._id} row={row} />
              ))}
            </ol>

            {view.hiddenNotes.length > 0 && (
              // Neutral: these claims were not removed, they are only not shown.
              <ul
                aria-label="Claims not shown"
                className="flex flex-col gap-1 border-b border-divider px-[22px] py-3 text-xs text-text-3"
              >
                {view.hiddenNotes.map((note) => (
                  <li key={note}>{note}.</li>
                ))}
              </ul>
            )}

            {view.openQuestions.length > 0 && (
              <section
                aria-labelledby="open-questions"
                className="flex flex-col gap-2 border-b border-divider px-[22px] py-3.5"
              >
                <h2 id="open-questions" className="text-[13px] font-extrabold text-text-2">
                  Open questions
                </h2>
                <ul className="flex list-disc flex-col gap-[5px] pl-[18px] text-sm leading-normal">
                  {view.openQuestions.map((question) => (
                    <li key={question}>{question}</li>
                  ))}
                </ul>
              </section>
            )}

            {removedCount > 0 && (
              <section
                aria-labelledby="removed-claims"
                className="mx-[22px] mt-3.5 flex items-start gap-3 rounded-panel border border-down/35 bg-down-tint px-4 py-3.5"
              >
                <RemovedIcon />
                <div className="flex flex-col gap-[3px]">
                  <h2 id="removed-claims" className="text-[13px] font-extrabold text-down">
                    {removedCount} {removedCount === 1 ? 'claim' : 'claims'} removed by verification
                  </h2>
                  {removedCount === 1 ? (
                    <p className="text-xs leading-normal text-text-2">
                      {view.removedReasons[0]}, so Kesher dropped it instead of showing it.
                    </p>
                  ) : (
                    <>
                      <ul className="flex list-disc flex-col pl-4 text-xs leading-normal text-text-2">
                        {view.removedReasons.map((reason, index) => (
                          <li key={index}>{reason}.</li>
                        ))}
                      </ul>
                      <p className="text-xs leading-normal text-text-2">
                        Kesher dropped them instead of showing them.
                      </p>
                    </>
                  )}
                  <Link
                    to={runPath(run._id, checkStep ?? undefined)}
                    className="inline-flex min-h-11 items-center text-xs font-extrabold text-down underline-offset-2 hover:underline"
                  >
                    See the check in the agent run
                  </Link>
                </div>
              </section>
            )}

            <p className="mx-[22px] mt-auto mb-3.5 pt-3.5 text-[11px] text-text-3">
              Kesher explains events. It never recommends buying or selling.
            </p>
          </div>
        </main>

        <aside
          aria-label="Connection and sources"
          className="flex flex-col overflow-hidden rounded-panel border border-border bg-panel xl:w-[360px] xl:shrink-0 xl:overflow-y-auto"
        >
          <section
            aria-labelledby="your-connection"
            className="flex flex-col gap-3.5 border-b border-border px-4 pt-3.5 pb-4"
          >
            <h2 id="your-connection" className="text-[15px] font-extrabold">
              Your connection
            </h2>
            {path && item ? (
              <>
                <RingPath path={path} />
                <div className="flex items-center gap-2.5 text-xs text-text-2">
                  <RelevancePill relevance={item.relevance} />
                  <span>{path.rowLabel}.</span>
                </div>
              </>
            ) : (
              <p className="text-xs text-text-3">No feed item for this event.</p>
            )}
          </section>

          <section aria-labelledby="report-sources" className="flex flex-col gap-2.5 px-4 py-3.5">
            <h2 id="report-sources" className="text-[15px] font-extrabold">
              Sources
            </h2>
            <ol aria-label="Sources" className="flex flex-col">
              {view.sources.map((source) => (
                <li
                  key={source._id}
                  className="grid grid-cols-[28px_minmax(0,1fr)] gap-x-2 gap-y-1 border-b border-divider py-2.5 last:border-b-0"
                >
                  <span className="text-xs font-extrabold text-text-3">[{source.number}]</span>
                  <span className="text-[13px] font-extrabold">{source.title}</span>
                  <span />
                  <span className="flex flex-wrap items-center gap-2 text-[11px] text-text-2">
                    <SourceChip source={source} />
                    <span className={source.kind === 'market_data' ? undefined : 'font-mono'}>
                      {source.ref}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
            <p className="text-[11px] leading-normal text-text-3">
              Facts need a Tier 1 or Tier 2 source. Social posts can start research, but never back
              a fact.
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}
