import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { MARK } from '../brand/mark';
import { AGENT_RUNS_PATH, FEED_PATH } from '../routes';
import { formatEt } from '../view/format';

// The Route mark, the favicon's geometry; its token colors are MARK's, as class names.
function Logo() {
  const { size, line, ring, dot } = MARK;
  return (
    <svg width="24" height="24" viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <path
        d={line.d}
        className="fill-none stroke-supplier"
        strokeWidth={line.width}
        strokeLinecap="round"
      />
      <circle
        cx={ring.cx}
        cy={ring.cy}
        r={ring.r}
        className="fill-bg stroke-text"
        strokeWidth={ring.width}
      />
      <circle cx={dot.cx} cy={dot.cy} r={dot.r} className="fill-you" />
    </svg>
  );
}

export type Tab = 'feed' | 'runs';

const TAB =
  'flex h-11 items-center rounded-button border px-3.5 text-sm whitespace-nowrap focus-visible:outline-2 focus-visible:outline-you';
const TAB_STATE = {
  current: 'border-you-border bg-you-tint font-bold text-you',
  other: 'border-transparent font-semibold text-text-2 hover:text-text',
};

function TabLink({ to, current, children }: { to: string; current: boolean; children: string }) {
  return (
    <Link
      to={to}
      aria-current={current ? 'page' : undefined}
      className={`${TAB} ${current ? TAB_STATE.current : TAB_STATE.other}`}
    >
      {children}
    </Link>
  );
}

export function SearchBox() {
  return (
    <div className="w-[300px] min-w-[160px] shrink">
      <label htmlFor="kesher-search" className="sr-only">
        Search
      </label>
      <input
        id="kesher-search"
        type="search"
        placeholder="Search ticker or event"
        className="h-11 w-full rounded-button border border-border bg-inset px-3.5 text-[13px] text-text placeholder:text-text-3 focus-visible:outline-2 focus-visible:outline-you"
      />
    </div>
  );
}

// The time of the replayed headline, in ET.
export function ReplayStatus({ at }: { at: Date }) {
  return (
    <div className="flex h-8 items-center gap-2 rounded-button border border-border bg-raised px-3 text-xs whitespace-nowrap text-text-2">
      <span className="block size-2 rounded-full bg-you motion-safe:animate-live" />
      <span className="font-bold text-you">Replay</span>
      <span className="tabular-nums">{formatEt(at)}</span>
    </div>
  );
}

interface ReplayProps {
  busy: boolean;
  onReplay: () => void;
}

// Development only: resets and replays the demo item, so every open session sees it arrive.
export function ReplayButton({ busy, onReplay }: ReplayProps) {
  return (
    <button
      type="button"
      onClick={onReplay}
      disabled={busy}
      className="flex h-11 cursor-pointer items-center rounded-button border border-border-strong px-3.5 text-[13px] font-bold whitespace-nowrap text-text hover:border-you focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-you disabled:cursor-default disabled:opacity-60"
    >
      {busy ? 'Replaying' : 'Replay demo event'}
    </button>
  );
}

// Whose report or run this is. A label, not a control: the persona switcher lives on the feed.
export function ViewingAs({ label }: { label: string }) {
  return (
    <div className="flex h-8 items-center gap-2 rounded-button border border-you-border bg-you-tint px-3 text-xs whitespace-nowrap text-text-2">
      <span>Viewing as</span>
      <span className="font-extrabold text-you">{label}</span>
    </div>
  );
}

interface Props {
  current: Tab;
  // Screen controls: before the spacer (search) and after it (replay status, persona).
  start?: ReactNode;
  children: ReactNode;
}

// Below 1280px the bar wraps onto a second line instead of squeezing the controls.
export function TopBar({ current, start, children }: Props) {
  return (
    <header className="flex min-h-14 shrink-0 flex-wrap items-center gap-x-[18px] gap-y-2 border-b border-border bg-panel px-5 py-1.5 xl:h-14 xl:flex-nowrap xl:py-0">
      <Link
        to={FEED_PATH}
        aria-label="Kesher home"
        className="flex h-11 items-center gap-[9px] text-text"
      >
        <Logo />
        <span className="text-lg font-extrabold tracking-[0.01em]">Kesher</span>
      </Link>
      <nav aria-label="Main" className="flex gap-1.5">
        <TabLink to={FEED_PATH} current={current === 'feed'}>
          Feed
        </TabLink>
        <TabLink to={AGENT_RUNS_PATH} current={current === 'runs'}>
          Agent runs
        </TabLink>
      </nav>
      {start}
      <div className="hidden grow xl:block" />
      {children}
    </header>
  );
}
