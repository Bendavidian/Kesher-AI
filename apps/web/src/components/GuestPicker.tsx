import {
  MAX_GUEST_HOLDINGS,
  SHORT_NAME,
  UNIVERSE_SECTORS,
  type UniverseSymbol,
} from '@kesher/shared';
import { Modal } from '@mantine/core';
import { useState } from 'react';

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
  'flex h-11 cursor-pointer items-center justify-center rounded-button border border-border-strong px-4 text-sm font-bold text-text hover:border-you focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-you disabled:cursor-default disabled:opacity-60';

// The guest portfolio picker (SPEC.md decision log, T24), a Mantine Modal since T29: 1 to 6
// universe companies by sector. Choosing only picks holdings; code scores every stored event for
// them, as for the personas.
export function GuestPicker({ initial, changing, busy, error, onSubmit, onCancel }: Props) {
  const [picked, setPicked] = useState<UniverseSymbol[]>(() =>
    initial.slice(0, MAX_GUEST_HOLDINGS),
  );
  const full = picked.length >= MAX_GUEST_HOLDINGS;

  const toggle = (symbol: UniverseSymbol) =>
    setPicked((current) =>
      current.includes(symbol) ? current.filter((s) => s !== symbol) : [...current, symbol],
    );

  return (
    <Modal
      opened
      onClose={onCancel}
      title="Your portfolio"
      size={640}
      withCloseButton={false}
      classNames={{
        overlay: 'bg-bg/80',
        content: 'rounded-panel border border-border bg-panel',
        header: 'bg-panel px-5 pt-5 pb-1 min-h-0',
        title: 'text-[15px] font-extrabold text-text',
        body: 'flex flex-col gap-4 px-5 pb-5',
      }}
    >
      <p className="text-[13px] leading-normal text-text-2">
        Pick 1 to {MAX_GUEST_HOLDINGS} companies. Kesher scores every stored event for them with the
        same code as the personas.
      </p>

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

      <p className="text-xs leading-normal text-text-3">
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
        <div className="flex flex-wrap gap-2">
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
    </Modal>
  );
}
