import type { ReactNode } from 'react';
import { formatEt } from '../view/format';

function Logo() {
  return (
    <svg width="24" height="24" viewBox="0 0 28 28" aria-hidden="true">
      <path
        d="M6 22 L6 13 Q6 6 13 6 L22 6"
        className="fill-none stroke-supplier"
        strokeWidth="3.5"
        strokeLinecap="round"
      />
      <circle cx="6" cy="22" r="4" className="fill-panel stroke-text" strokeWidth="3" />
      <circle cx="22" cy="6" r="4" className="fill-you stroke-you" strokeWidth="3" />
    </svg>
  );
}

interface Props {
  // The time of the replayed headline, or null when nothing is replaying.
  replayAt: Date | null;
  // The persona switcher.
  children: ReactNode;
}

// Below 1280px the bar wraps onto a second line instead of squeezing the controls.
export function TopBar({ replayAt, children }: Props) {
  return (
    <header className="flex min-h-14 shrink-0 flex-wrap items-center gap-x-[18px] gap-y-2 border-b border-border bg-panel px-5 py-1.5 xl:h-14 xl:flex-nowrap xl:py-0">
      <a href="/" aria-label="Kesher home" className="flex h-11 items-center gap-[9px] text-text">
        <Logo />
        <span className="text-lg font-extrabold tracking-[0.01em]">Kesher</span>
      </a>
      <nav aria-label="Main" className="flex gap-1.5">
        <a
          href="/"
          aria-current="page"
          className="flex h-11 items-center rounded-button border border-you-border bg-you-tint px-3.5 text-sm font-bold whitespace-nowrap text-you"
        >
          Feed
        </a>
        {/* The Agent runs view arrives with T09. */}
        <span className="flex h-11 items-center rounded-button border border-transparent px-3.5 text-sm font-semibold whitespace-nowrap text-text-2">
          Agent runs
        </span>
      </nav>
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
      <div className="hidden grow xl:block" />
      {replayAt && (
        <div className="flex h-8 items-center gap-2 rounded-button border border-border bg-raised px-3 text-xs whitespace-nowrap text-text-2">
          <span className="block size-2 rounded-full bg-you motion-safe:animate-live" />
          <span className="font-bold text-you">Replay</span>
          <span className="tabular-nums">{formatEt(replayAt)}</span>
        </div>
      )}
      {children}
    </header>
  );
}
