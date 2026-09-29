import { SHORT_NAME, type PublicUser, type RunDetail, type RunSummary } from '@kesher/shared';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, Navigate, useParams, useSearchParams } from 'react-router';
import { ApiError } from '../api/client';
import { CheckIcon } from '../components/EvidenceCard';
import { RecentRuns } from '../components/RecentRuns';
import { StepDetail } from '../components/StepDetail';
import { StepTimeline } from '../components/StepTimeline';
import { STATUS_CHIP, TONE_CLASS } from '../components/stepTone';
import { TopBar, ViewingAs } from '../components/TopBar';
import { useLiveDeps } from '../live/deps';
import { FEED_PATH, reportPath, runPath } from '../routes';
import { personaFrom } from '../view/personas';
import {
  buildRunView,
  outputView,
  runOption,
  TONE_LABEL,
  tokenScope,
  withPushedStep,
  type StepTone,
} from '../view/run';
import { NotFoundScreen } from './NotFoundScreen';

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

// TSMC for TSM; "this" when the event has no extraction or a company outside the universe.
function eventName(symbol: string | null): string {
  return symbol && symbol in SHORT_NAME ? SHORT_NAME[symbol as keyof typeof SHORT_NAME] : 'this';
}

// Waiting on the api, or why it gave nothing to show.
function StatusScreen({ message, error }: { message: string; error: boolean }) {
  return (
    <div className="flex min-h-screen flex-col">
      <TopBar current="runs">{null}</TopBar>
      <main className="flex flex-1 p-3">
        <p
          role={error ? 'alert' : 'status'}
          className="h-fit rounded-panel border border-border bg-panel px-[22px] py-4 text-sm text-text-2"
        >
          {message}
        </p>
      </main>
    </div>
  );
}

const loadError = (error: unknown, what: string) =>
  error instanceof ApiError && error.status === 401
    ? 'Sign in from the feed to see your agent runs.'
    : `Could not load ${what}. Check that the api is running.`;

// The Agent runs tab: opens the signed in user's newest run, or says there is none yet.
export function RunsIndexScreen() {
  const { api } = useLiveDeps();
  const [load, setLoad] = useState<
    | { status: 'loading' }
    | { status: 'ready'; runs: RunSummary[] }
    | { status: 'error'; message: string }
  >({ status: 'loading' });

  useEffect(() => {
    let active = true;
    api.runs().then(
      (runs) => active && setLoad({ status: 'ready', runs }),
      (error: unknown) =>
        active && setLoad({ status: 'error', message: loadError(error, 'your agent runs') }),
    );
    return () => {
      active = false;
    };
  }, [api]);

  if (load.status === 'loading')
    return <StatusScreen message="Loading your agent runs." error={false} />;
  if (load.status === 'error') return <StatusScreen message={load.message} error />;
  const newest = load.runs[0];
  if (newest) return <Navigate to={runPath(newest._id)} replace />;
  return (
    <div className="flex min-h-screen flex-col">
      <TopBar current="runs">{null}</TopBar>
      <main className="flex flex-1 flex-col p-3">
        <section className="flex flex-col items-start gap-2 rounded-panel border border-dashed border-border-strong bg-panel px-[22px] py-[18px]">
          <h1 className="text-[15px] font-extrabold">No agent runs yet</h1>
          <p className="text-[13px] text-text-2">Investigate an event on the feed to start one.</p>
          <Link
            to={FEED_PATH}
            className="flex h-11 items-center text-[13px] font-bold text-supplier-light underline-offset-2 hover:underline"
          >
            Back to your feed
          </Link>
        </section>
      </main>
    </div>
  );
}

type Load =
  | { status: 'loading' }
  | { status: 'missing' }
  | { status: 'error'; message: string }
  | { status: 'ready'; detail: RunDetail };

// GET /runs/:runId for the signed in user. run:step adds each new step as the run stores it, and
// run:end reads the run again for its final state. A run the card names can answer 404 for a
// moment before runResearch stores it; its first run:step reads it again.
export function RunScreen() {
  const { runId = '' } = useParams();
  const { api, connectFeed } = useLiveDeps();
  const [load, setLoad] = useState<{ runId: string } & Load>({ runId, status: 'loading' });
  const [reads, setReads] = useState(0);
  const [user, setUser] = useState<PublicUser | null>(null);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const current = useRef(load);
  useEffect(() => {
    current.current = load;
  }, [load]);

  useEffect(() => {
    let active = true;
    api.run(runId).then(
      (detail) => active && setLoad({ runId, status: 'ready', detail }),
      (error: unknown) => {
        if (!active) return;
        if (error instanceof ApiError && (error.status === 404 || error.status === 400)) {
          setLoad({ runId, status: 'missing' });
        } else {
          setLoad({ runId, status: 'error', message: loadError(error, 'the agent run') });
        }
      },
    );
    return () => {
      active = false;
    };
  }, [api, runId, reads]);

  // The run list follows the reads, so a run that just ended shows its new status.
  useEffect(() => {
    let active = true;
    api.runs().then(
      (rows) => active && setRuns(rows),
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [api, runId, reads]);

  useEffect(() => {
    let active = true;
    api.me().then(
      (me) => active && setUser(me),
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [api]);

  useEffect(() => {
    const readAgain = () => setReads((n) => n + 1);
    const socket = connectFeed({
      onRunStep(pushed) {
        if (pushed.runId !== runId) return;
        const shown = current.current;
        if (shown.runId !== runId || shown.status !== 'ready') {
          readAgain();
          return;
        }
        const run = withPushedStep(shown.detail.run, pushed);
        if (run === 'gap') readAgain();
        else if (run !== shown.detail.run) {
          setLoad({ ...shown, detail: { ...shown.detail, run } });
        }
      },
      onRunEnd(ended) {
        if (ended.runId === runId) readAgain();
      },
    });
    return () => socket.close();
  }, [connectFeed, runId]);

  const shown: Load = load.runId === runId ? load : { status: 'loading' };
  if (shown.status === 'missing') return <NotFoundScreen what="agent run" />;
  if (shown.status === 'loading')
    return <StatusScreen message="Loading the agent run." error={false} />;
  if (shown.status === 'error') return <StatusScreen message={shown.message} error />;
  return <RunBody detail={shown.detail} user={user} runs={runs} />;
}

function RunBody({
  detail,
  user,
  runs,
}: {
  detail: RunDetail;
  user: PublicUser | null;
  runs: RunSummary[];
}) {
  const { run, reportId } = detail;
  const [params, setParams] = useSearchParams();
  const persona = user && personaFrom(user);
  const view = buildRunView(run, eventName(detail.eventSymbol), detail.limits);
  const options = runs.map((row) => runOption(row, eventName(row.eventSymbol)));
  const scope = tokenScope(run);

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
            <div className="flex items-center justify-between gap-3">
              <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-xs text-text-3">
                <Link
                  to={reportId ? reportPath(reportId) : FEED_PATH}
                  className="inline-block py-3 font-bold text-supplier-light hover:underline"
                >
                  {reportId ? 'Research report' : 'Feed'}
                </Link>
                <span aria-hidden="true">/</span>
                <span>Agent run</span>
              </nav>
              <RecentRuns key={run._id} options={options} currentId={run._id} />
            </div>
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
            output={outputView(selectedView.step)}
            scope={scope}
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
