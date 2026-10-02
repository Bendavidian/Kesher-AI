import { Tooltip } from '@mantine/core';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { reportPath, runPath } from '../routes';
import { formatScore, joinList } from '../view/format';
import { CONFIDENCE_LABEL, CONFIDENCE_NOTE, IMPORTANCE_LABEL, type EventView } from '../view/feed';
import { EvidenceCard } from './EvidenceCard';

type Decider = 'code' | 'model';

// The tooltip says who set the score and how (T29), as principle 2 has it: the model classifies,
// code computes.
const DECIDER_TAG: Record<Decider, { label: string; className: string; tip: string }> = {
  code: {
    label: 'By code',
    className: 'bg-code-tint text-code',
    tip: 'Computed by code from stored data. No model sets this number.',
  },
  model: {
    label: 'By the model',
    className: 'bg-model-tint text-model',
    tip: 'Classified by the model from 1 to 5 against a fixed rubric. Code computes the other scores.',
  },
};

interface ScoreProps {
  label: string;
  by: Decider;
  value: ReactNode;
  valueClass: string;
  note: string;
  testId?: string;
}

function Score({ label, by, value, valueClass, note, testId }: ScoreProps) {
  const tag = DECIDER_TAG[by];
  return (
    <div className="flex flex-col gap-[3px] border-b border-divider px-4 py-3">
      <span className="flex items-center justify-between">
        <span className="text-xs font-bold text-text-2">{label}</span>
        <Tooltip
          label={tag.tip}
          multiline
          position="left"
          events={{ hover: true, focus: true, touch: true }}
          classNames={{
            tooltip:
              'w-[240px] rounded-button border border-border-strong bg-raised px-3 py-2 text-xs leading-normal font-normal text-text',
          }}
        >
          {/* A 44px target around the small tag: the pseudo element widens what takes the
              pointer, the tag keeps its size. */}
          <span
            tabIndex={0}
            className={`relative cursor-help rounded-[5px] px-[7px] py-0.5 text-[10px] font-extrabold before:absolute before:-inset-x-2 before:-inset-y-[13px] before:content-[''] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-you ${tag.className}`}
          >
            {tag.label}
          </span>
        </Tooltip>
      </span>
      <span
        data-testid={testId}
        className={`text-[26px] leading-[1.15] font-extrabold tabular-nums ${valueClass}`}
      >
        {value}
      </span>
      <span className="text-xs text-text-3">{note}</span>
    </div>
  );
}

function Note({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-panel border border-border bg-inset px-3.5 py-3 text-[13px] leading-normal text-text-2">
      {children}
    </p>
  );
}

const PRIMARY =
  'flex h-11 items-center justify-center rounded-button bg-you text-sm font-extrabold text-on-you';
const SECONDARY =
  'flex h-11 items-center justify-center rounded-button border border-border-strong text-sm font-bold text-text';

// The Investigate request itself: busy until the api answers, then the card carries the state.
// A request that fails is a notification (T29).
export interface InvestigateRequest {
  busy: boolean;
}

// Investigate, the research state on the card and the link to its report. The state comes from
// the FeedItem, written by code as the run goes (docs/INTERFACES.md).
function ResearchActions({
  view,
  request,
  onInvestigate,
}: {
  view: EventView;
  request: InvestigateRequest;
  onInvestigate: () => void;
}) {
  const research = view.research;
  const running = request.busy || research?.state === 'running' || research?.state === 'queued';
  const reportId = research?.state === 'done' ? research.reportId : null;
  // Set from the start of a run, so its steps can be watched while it goes.
  const runId = research?.runId ?? null;

  let status: string | null = null;
  if (running) status = 'Researching this event. The card updates when the report is ready.';
  else if (research?.state === 'failed') status = 'The last research run ended without a report.';

  const investigate = (label: string, className: string) => (
    <button
      type="button"
      disabled={running}
      onClick={onInvestigate}
      className={`${className} disabled:opacity-60`}
    >
      {running ? 'Investigating…' : label}
    </button>
  );

  return (
    <div className="flex flex-col gap-2">
      <p aria-live="polite" className="text-xs text-text-2 empty:hidden">
        {status}
      </p>
      {reportId && !running ? (
        <>
          <Link to={reportPath(reportId)} className={PRIMARY}>
            Open research report
          </Link>
          {investigate('Investigate again', SECONDARY)}
        </>
      ) : (
        investigate('Investigate this event', PRIMARY)
      )}
      {runId ? (
        <Link to={runPath(runId)} className={`${SECONDARY} hover:bg-raised`}>
          View agent run
        </Link>
      ) : (
        <button type="button" disabled className={`${SECONDARY} disabled:opacity-60`}>
          View agent run
        </button>
      )}
    </div>
  );
}

const IDLE: InvestigateRequest = { busy: false };

export function ScoresPanel({
  view,
  investigate = IDLE,
  onInvestigate = () => undefined,
  className = '',
}: {
  view: EventView | null;
  investigate?: InvestigateRequest;
  onInvestigate?: () => void;
  className?: string;
}) {
  const importance = view?.event.extraction?.importance;

  let evidence: ReactNode = null;
  if (view?.path.kind === 'none') {
    evidence = (
      <Note>
        No reviewed edge connects {view.path.eventName} to {joinList(view.held, 'or')}.
      </Note>
    );
  } else if (view?.path.direct) {
    evidence = <Note>Direct holding. No relationship is needed, so there is no edge to cite.</Note>;
  } else if (view) {
    evidence = view.evidence.map((item) => <EvidenceCard key={item.filingLabel} evidence={item} />);
  }

  return (
    <aside
      aria-label="Scores and evidence"
      className={`flex flex-col overflow-hidden rounded-panel border border-border bg-panel ${className}`}
    >
      <div className="border-b border-border px-4 py-3.5">
        <h2 className="text-[15px] font-extrabold">Scores</h2>
      </div>
      <div className="flex flex-col xl:min-h-0 xl:flex-1 xl:overflow-y-auto">
        {view && (
          <div className="flex flex-col">
            <Score
              label="Relevance"
              by="code"
              value={formatScore(view.score.relevance)}
              valueClass="text-you"
              note={view.relevanceNote}
              testId="relevance-value"
            />
            <Score
              label="Importance"
              by="model"
              value={importance ? `${importance} of 5` : 'Pending'}
              valueClass="text-model"
              note={
                importance
                  ? `${IMPORTANCE_LABEL[importance]}, per the rubric.`
                  : 'Not extracted yet.'
              }
            />
            <Score
              label="Confidence"
              by="code"
              value={CONFIDENCE_LABEL[view.score.confidence]}
              valueClass="text-code"
              note={CONFIDENCE_NOTE[view.score.confidence]}
            />
            <p className="border-b border-border px-4 py-2.5 text-[11px] leading-normal text-text-3">
              Relevance changes with each investor. Importance and confidence belong to the event.
            </p>
          </div>
        )}

        <div className="flex flex-1 flex-col gap-2.5 px-4 py-3.5">
          <h2 className="text-[15px] font-extrabold">Evidence</h2>
          {evidence}

          <div className="mt-auto flex flex-col gap-2 pt-2">
            {view && view.score.relevance > 0 && (
              <ResearchActions view={view} request={investigate} onInvestigate={onInvestigate} />
            )}
            {view && view.score.relevance <= 0 && (
              <p className="text-xs text-text-2">
                This event is not in your feed, so there is nothing to investigate for you.
              </p>
            )}
            <p className="text-[11px] text-text-3">
              Kesher explains events. It never recommends buying or selling.
            </p>
          </div>
        </div>
      </div>
    </aside>
  );
}
