// The replayed session's closing moves arrive with replay (T03) and the price reaction (T13).
export function TickerFooter() {
  return (
    <footer
      aria-label="Replayed session"
      className="flex h-[34px] shrink-0 items-center gap-[22px] border-t border-border bg-panel px-5 text-xs text-text-3"
    >
      <span>No replayed session</span>
      <span className="ml-auto">SIP data, delayed 15 minutes</span>
    </footer>
  );
}
