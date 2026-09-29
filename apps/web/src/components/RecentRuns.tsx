import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router';
import { runPath } from '../routes';
import type { RunOption } from '../view/run';
import { STATUS_CHIP } from './stepTone';

interface Props {
  options: RunOption[];
  currentId: string;
}

// The Recent runs selector in the run screen header (docs/UI.md, Agent run screen): the signed in
// user's runs from GET /runs, newest first, each a link to its run.
export function RecentRuns({ options, currentId }: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (options.length === 0) return null;

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((value) => !value)}
        className="flex h-11 cursor-pointer items-center gap-2 rounded-button border border-border-strong px-3.5 text-[13px] font-bold whitespace-nowrap text-text hover:bg-raised focus-visible:outline-2 focus-visible:outline-you"
      >
        Recent runs
        <span className="text-text-3 tabular-nums">{options.length}</span>
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path
            d={open ? 'M1 7 L5 3 L9 7' : 'M1 3 L5 7 L9 3'}
            className="fill-none stroke-text-2"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
      </button>
      {open && (
        <ul
          id={listId}
          aria-label="Recent runs"
          className="absolute top-full right-0 z-10 mt-1.5 flex max-h-[360px] w-[380px] max-w-[calc(100vw-32px)] flex-col overflow-y-auto rounded-panel border border-border-strong bg-panel p-1.5"
        >
          {options.map((option) => {
            const current = option.id === currentId;
            return (
              <li key={option.id}>
                <Link
                  to={runPath(option.id)}
                  aria-current={current ? 'page' : undefined}
                  onClick={() => setOpen(false)}
                  className={`flex min-h-11 items-center gap-3 rounded-button px-3 py-1.5 text-[13px] hover:bg-raised focus-visible:outline-2 focus-visible:outline-you ${current ? 'bg-raised' : ''}`}
                >
                  <span className="shrink-0 text-xs text-text-3 tabular-nums">{option.time}</span>
                  <span className="min-w-0 grow truncate font-bold text-text">{option.label}</span>
                  <span
                    className={`shrink-0 rounded-chip px-2 py-0.5 text-[11px] font-extrabold ${STATUS_CHIP[option.status.tone]}`}
                  >
                    {option.status.label}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
