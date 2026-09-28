import type { ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { CheckIcon } from '../components/EvidenceCard';
import { StepDetail } from '../components/StepDetail';
import { StepTimeline } from '../components/StepTimeline';
import { TONE_CLASS } from '../components/stepTone';
import { TopBar, ViewingAs } from '../components/TopBar';
import { DEMO_RESEARCH, DEMO_STORE, PERSONAS } from '../fixtures';
import { FEED_PATH, reportPath } from '../routes';
import { SHORT_NAME } from '../view/companies';
import { buildRunView, TONE_LABEL, type RunView, type StepTone } from '../view/run';
import { NotFoundScreen } from './NotFoundScreen';

const STATUS_CHIP: Record<RunView['status']['tone'], string> = {
  up: 'bg-up-tint text-up',
  down: 'bg-down-tint text-down',
  neutral: 'bg-border text-text-2',
};

const LEGEND: StepTone[] = ['code', 'tool', 'model', 'removed'];

interface TileProps {
  label: string;
  value: ReactNode;
  className: string;
  labelClass: string;
  valueClass: string;
}

function Tile({ label, value, className, labelClass, valueClass }: TileProps) {
  return (
    <div className={`flex min-w-0 flex-col gap-px rounded-button border px-3 py-2 ${className}`}>
      <dt className={`text-[11px] font-bold ${labelClass}`}>{label}</dt>
      <dd className={`font-extrabold tabular-nums ${valueClass}`}>{value}</dd>
    </div>
  );
}

// Fixtures only until T09 reads the run from the api.
function eventName(eventId: string): string {
  const symbol = DEMO_STORE.events.find((event) => event._id === eventId)?.extraction?.companies[0]
    ?.symbol;
  return symbol && symbol in SHORT_NAME ? SHORT_NAME[symbol as keyof typeof SHORT_NAME] : 'this';
}

export function RunScreen() {
  const { runId } = useParams();
  const [params, setParams] = useSearchParams();
  const run = DEMO_RESEARCH.runs.find((r) => r._id === runId);
  if (!run) return <NotFoundScreen what="agent run" />;

  const report = DEMO_RESEARCH.reports.find((r) => r.runId === run._id);
  const claims = DEMO_RESEARCH.claims.filter((claim) => claim.reportId === report?._id);
  const persona = PERSONAS.find((p) => p._id === run.userId);
  const view = buildRunView(run, claims, eventName(run.eventId));

  const requested = Number(params.get('step'));
  const selected =
    Number.isInteger(requested) && requested >= 1 && requested <= view.steps.length ? requested : 1;
  const selectedView = view.steps[selected - 1];

  return (
    <div className="flex min-h-screen flex-col xl:h-screen">
      <TopBar current="runs">{persona && <ViewingAs label={persona.switcherLabel} />}</TopBar>
      <div className="flex flex-1 flex-col gap-3 p-3 xl:min-h-0 xl:flex-row">
        <main className="flex flex-col overflow-hidden rounded-panel border border-border bg-panel xl:w-[680px] xl:shrink-0">
          <div className="flex flex-col gap-2.5 border-b border-border px-5 pt-2.5 pb-3.5">
            <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-xs text-text-3">
              <Link
                to={report ? reportPath(report._id) : FEED_PATH}
                className="inline-block py-3 font-bold text-supplier-light hover:underline"
              >
                {report ? 'Research report' : 'Feed'}
              </Link>
              <span aria-hidden="true">/</span>
              <span>Agent run</span>
            </nav>
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-2xl leading-[1.2] font-extrabold">Research run</h1>
              <span className="rounded-chip bg-border px-[9px] py-1 text-xs font-extrabold text-text-2">
                {view.mode}
              </span>
              <span
                className={`flex items-center gap-[5px] rounded-chip px-[9px] py-1 text-xs font-extrabold ${STATUS_CHIP[view.status.tone]}`}
              >
                {view.status.tone === 'up' && <CheckIcon size={12} />}
                {view.status.label}
              </span>
            </div>
            <p className="text-[13px] text-text-2">{view.summary}</p>
            <dl
              role="group"
              aria-label="Run summary"
              className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_1fr_1.5fr_0.8fr]"
            >
              <Tile
                label="Tool calls"
                value={view.toolCalls}
                className="border-supplier/25 bg-supplier-tint"
                labelClass="text-supplier-light"
                valueClass="text-[17px] text-supplier"
              />
              <Tile
                label="Tokens"
                value={view.tokens}
                className="border-model/25 bg-model-tint"
                labelClass="text-model/80"
                valueClass="text-[17px] text-model"
              />
              <Tile
                label="Model"
                value={view.model ?? 'None'}
                className="border-border bg-raised"
                labelClass="text-text-3"
                valueClass="truncate text-[15px] leading-[1.6]"
              />
              <Tile
                label="Cost"
                value={view.cost}
                className="border-code/25 bg-code-tint"
                labelClass="text-code/80"
                valueClass="text-[17px] text-code"
              />
            </dl>
            <ul
              aria-label="Step kinds"
              className="flex flex-wrap gap-x-3.5 gap-y-1 text-[11px] font-bold text-text-2"
            >
              {LEGEND.map((tone) => (
                <li key={tone} className="flex items-center gap-1.5">
                  <span className={`block h-[3px] w-4 rounded-sm ${TONE_CLASS[tone].line}`} />
                  {TONE_LABEL[tone]}
                </li>
              ))}
            </ul>
          </div>
          <div className="xl:min-h-0 xl:flex-1 xl:overflow-y-auto">
            <StepTimeline
              steps={view.steps}
              selected={selected}
              onSelect={(step) => setParams({ step: String(step) }, { replace: true })}
            />
          </div>
        </main>

        {selectedView && (
          <StepDetail
            view={selectedView}
            total={view.steps.length}
            output={DEMO_RESEARCH.stepOutputs[run._id]?.[selected - 1]}
            scope={DEMO_RESEARCH.tokenScopes[run._id]}
            className="xl:min-w-0 xl:flex-1 xl:overflow-y-auto"
          />
        )}
      </div>

      <footer
        aria-label="Run limits"
        className="flex min-h-[34px] shrink-0 flex-wrap items-center gap-x-[22px] gap-y-1 border-t border-border bg-panel px-5 py-1.5 text-xs text-text-3 tabular-nums"
      >
        {view.limits.map((limit) => (
          <span key={limit}>{limit}</span>
        ))}
        <span className="hidden grow xl:block" />
        <span>{view.budget}</span>
      </footer>
    </div>
  );
}
