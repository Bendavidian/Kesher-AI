import {
  MAX_GUEST_HOLDINGS,
  SHORT_NAME,
  UNIVERSE_SECTORS,
  type UniverseSymbol,
} from '@kesher/shared';
import { useEffect, useRef, useState } from 'react';

interface Props {
  // The companies picked when it opens: the guest's holdings, or the visitor's last pick.
  initial: readonly UniverseSymbol[];
  // A guest changes its holdings; anyone else creates a guest.
  changing: boolean;
  busy: boolean;
  error: string | null;
  onSubmit: (symbols: UniverseSymbol[]) => void;
  onCancel: () => void;
}

const PRIMARY =
  'flex h-11 cursor-pointer items-center justify-center rounded-button bg-you px-4 text-sm font-extrabold text-on-you focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-you disabled:cursor-default disabled:opacity-60';
const SECONDARY =
  'flex h-11 cursor-pointer items-center justify-center rounded-button border border-border-strong px-4 text-sm font-bold text-text hover:border-you focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-you';

// The guest portfolio picker (SPEC.md decision log, T24): 1 to 6 universe companies by sector.
// Choosing only picks holdings; code scores every stored event for them, as for the personas.
export function GuestPicker({ initial, changing, busy, error, onSubmit, onCancel }: Props) {
  const [picked, setPicked] = useState<UniverseSymbol[]>(() =>
    initial.slice(0, MAX_GUEST_HOLDINGS),
  );
  const dialog = useRef<HTMLDivElement>(null);
  const full = picked.length >= MAX_GUEST_HOLDINGS;

  useEffect(() => {
    dialog.current?.querySelector<HTMLButtonElement>('button')?.focus();
  }, []);

  const toggle = (symbol: UniverseSymbol) =>
    setPicked((current) =>
      current.includes(symbol) ? current.filter((s) => s !== symbol) : [...current, symbol],
    );

  return (
    <div className="fixed inset-0 z-20 flex items-start justify-center overflow-y-auto bg-bg/80 p-4 sm:items-center">
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="guest-picker-title"
        aria-describedby="guest-picker-note"
        onKeyDown={(event) => {
          if (event.key === 'Escape') onCancel();
        }}
        className="flex w-full max-w-[640px] flex-col gap-4 rounded-panel border border-border bg-panel p-5"
      >
        <div className="flex flex-col gap-1">
          <h2 id="guest-picker-title" className="text-[15px] font-extrabold">
            Your portfolio
          </h2>
          <p className="text-[13px] leading-normal text-text-2">
            Pick 1 to {MAX_GUEST_HOLDINGS} companies. Kesher scores every stored event for them with
            the same code as the personas.
          </p>
        </div>

        {UNIVERSE_SECTORS.map((sector) => (
          <fieldset key={sector.label} className="flex flex-col gap-2">
            <legend className="mb-2 text-[13px] font-extrabold">{sector.label}</legend>
            <div className="flex flex-wrap gap-2">
              {sector.symbols.map((symbol) => {
                const pressed = picked.includes(symbol);
                return (
                  <button
                    key={symbol}
                    type="button"
                    aria-pressed={pressed}
                    disabled={!pressed && full}
                    onClick={() => toggle(symbol)}
                    className={`flex h-11 cursor-pointer items-center gap-2 rounded-button border px-3 text-[13px] whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-you disabled:cursor-default disabled:opacity-40 ${
                      pressed
                        ? 'border-you bg-you-tint text-text'
                        : 'border-border-strong bg-inset text-text-2 hover:text-text'
                    }`}
                  >
                    <span className={`font-mono font-bold ${pressed ? 'text-you' : ''}`}>
                      {symbol}
                    </span>
                    <span>{SHORT_NAME[symbol]}</span>
                  </button>
                );
              })}
            </div>
          </fieldset>
        ))}

        <p id="guest-picker-note" className="text-xs leading-normal text-text-3">
          A guest portfolio is deleted after 24 hours. Investigate runs once a day for it.
        </p>
        {error && (
          <p role="alert" className="text-[13px] text-text-2">
            {error}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-xs font-bold text-text-2 tabular-nums">
            {picked.length} of {MAX_GUEST_HOLDINGS} picked
          </span>
          <div className="flex gap-2">
            <button type="button" onClick={onCancel} className={SECONDARY}>
              Cancel
            </button>
            <button
              type="button"
              disabled={picked.length === 0 || busy}
              onClick={() => onSubmit(picked)}
              className={PRIMARY}
            >
              {busy ? 'Scoring your feed' : changing ? 'Update my feed' : 'Show my feed'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
