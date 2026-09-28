import type { ApiStatus } from '../api/health';

const API_LABEL: Record<ApiStatus, string> = {
  checking: 'Checking API',
  ok: 'API ok',
  unreachable: 'API unreachable',
};

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

// Search, the replay status and the persona switcher join the top bar in later tasks (T03, T06).
export function TopBar({ apiStatus }: { apiStatus: ApiStatus }) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-panel px-3 sm:gap-[18px] sm:px-5">
      <a href="/" aria-label="Kesher home" className="flex h-11 items-center gap-[9px] text-text">
        <Logo />
        <span className="text-lg font-extrabold tracking-[0.01em]">Kesher</span>
      </a>
      <nav aria-label="Main" className="flex gap-1.5">
        <a
          href="/"
          aria-current="page"
          className="flex h-11 items-center whitespace-nowrap rounded-button border border-you-border bg-you-tint px-3.5 text-sm font-bold text-you"
        >
          Feed
        </a>
        <span className="flex h-11 items-center whitespace-nowrap rounded-button border border-transparent px-3.5 text-sm font-semibold text-text-2">
          Agent runs
        </span>
      </nav>
      <span
        role="status"
        className="ml-auto whitespace-nowrap rounded-chip border border-border bg-inset px-2 py-1 font-mono text-xs text-text-3"
      >
        {API_LABEL[apiStatus]}
      </span>
    </header>
  );
}
