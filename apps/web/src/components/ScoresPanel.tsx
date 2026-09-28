import type { ReactNode } from 'react';
import { formatScore, joinList } from '../view/format';
import { CONFIDENCE_LABEL, CONFIDENCE_NOTE, IMPORTANCE_LABEL, type EventView } from '../view/feed';
import { EvidenceCard } from './EvidenceCard';

type Decider = 'code' | 'model';

const DECIDER_TAG: Record<Decider, { label: string; className: string }> = {
  code: { label: 'By code', className: 'bg-code-tint text-code' },
  model: { label: 'By the model', className: 'bg-model-tint text-model' },
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
        <span
          className={`rounded-[5px] px-[7px] py-0.5 text-[10px] font-extrabold ${tag.className}`}
        >
          {tag.label}
        </span>
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

export function ScoresPanel({
  view,
  className = '',
}: {
  view: EventView | null;
  className?: string;
}) {
  const importance = view?.event.extraction?.importance;
  const canInvestigate = view !== null && view.item.relevance > 0;

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
              value={formatScore(view.item.relevance)}
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
              value={CONFIDENCE_LABEL[view.item.confidence]}
              valueClass="text-code"
              note={CONFIDENCE_NOTE[view.item.confidence]}
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
            {canInvestigate && (
              // Research (T08) and the agent run view (T09) are not wired yet.
              <div className="flex flex-col gap-2">
                <button type="button" disabled className={`${PRIMARY} disabled:opacity-60`}>
                  Investigate this event
                </button>
                <button type="button" disabled className={`${SECONDARY} disabled:opacity-60`}>
                  View agent run
                </button>
              </div>
            )}
            {view && !canInvestigate && (
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
