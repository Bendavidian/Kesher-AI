import type { CSSProperties, ReactNode } from 'react';
import type { LineKind, PathStation, PathView } from '../view/path';

// The signature component (docs/UI.md, Connection path). Remount it with a new key to replay
// the motion, for example when the persona changes.

const LINE_BG: Record<LineKind, string> = {
  supplier: 'bg-supplier',
  competitor: 'bg-competitor',
  you: 'bg-you',
};
const LINE_TEXT: Record<LineKind, string> = {
  supplier: 'text-supplier',
  competitor: 'text-competitor',
  you: 'text-you',
};
const RING_BORDER: Record<LineKind, string> = {
  supplier: 'border-supplier',
  competitor: 'border-competitor',
  you: 'border-you',
};

// Stations pop in sequence and each line grows after the station it leaves.
const STEP_MS = 650;
const LINE_AFTER_MS = 200;
const ARRIVE_AFTER_MS = 200;

const delay = (ms: number): CSSProperties => ({ animationDelay: `${ms}ms` });

function gridColumns(stations: number): CSSProperties {
  return { gridTemplateColumns: Array(stations).fill('40px').join(' minmax(0, 1fr) ') };
}

function StationLabel({ station, muted = false }: { station: PathStation; muted?: boolean }) {
  return (
    <span className="-ml-[60px] flex w-[160px] flex-col items-center gap-px text-center">
      <span
        className={`text-[15px] font-extrabold ${station.you && !muted ? 'text-you' : 'text-text'}`}
      >
        {station.title}
      </span>
      <span className="text-xs text-text-3">{station.subtitle}</span>
    </span>
  );
}

function YouRing({ muted, arriveMs }: { muted: boolean; arriveMs: number }) {
  return (
    <span
      className={`flex size-10 items-center justify-center rounded-full border-[5px] bg-inset ${
        muted ? 'border-border-strong' : 'motion-safe:animate-you-arrive border-you'
      }`}
      style={muted ? undefined : delay(arriveMs)}
    >
      <span className={`block size-4 rounded-full ${muted ? 'bg-border-strong' : 'bg-you'}`} />
    </span>
  );
}

export function ConnectionPath({ path }: { path: PathView }) {
  if (path.kind === 'none') {
    const [from, you] = path.stations;
    return (
      <div
        role="img"
        aria-label={path.label}
        className="grid items-center gap-y-[9px] px-[70px]"
        style={gridColumns(2)}
      >
        <span />
        <span className="text-center text-xs font-bold text-text-3">{path.lineLabel}</span>
        <span />
        <span className="block size-10 rounded-full border-8 border-border-strong bg-inset" />
        <span className="block h-0 border-t-4 border-dashed border-border-strong" />
        <YouRing muted arriveMs={0} />
        <StationLabel station={from} muted />
        <span />
        <StationLabel station={you} muted />
      </div>
    );
  }

  const { stations, lines } = path;
  const labels: ReactNode[] = [];
  const track: ReactNode[] = [];
  const names: ReactNode[] = [];

  stations.forEach((station, index) => {
    const popMs = index * STEP_MS;
    labels.push(<span key={`s${index}`} />);
    names.push(<StationLabel key={`s${index}`} station={station} />);
    track.push(
      station.you ? (
        <span
          key={`s${index}`}
          data-motion
          className="block size-10 motion-safe:animate-station-pop"
          style={delay(popMs)}
        >
          <YouRing muted={false} arriveMs={popMs + ARRIVE_AFTER_MS} />
        </span>
      ) : (
        <span
          key={`s${index}`}
          data-motion
          className={`block size-10 rounded-full border-8 bg-inset motion-safe:animate-station-pop ${RING_BORDER[station.ring]}`}
          style={delay(popMs)}
        />
      ),
    );

    const line = lines[index];
    if (!line || index === stations.length - 1) return;
    labels.push(
      <span
        key={`l${index}`}
        className={`text-center text-xs font-extrabold ${LINE_TEXT[line.kind]}`}
      >
        {line.label}
      </span>,
    );
    track.push(
      <span
        key={`l${index}`}
        data-motion
        className={`block h-2 origin-left motion-safe:animate-line-grow ${LINE_BG[line.kind]}`}
        style={delay(popMs + LINE_AFTER_MS)}
      />,
    );
    names.push(<span key={`l${index}`} />);
  });

  return (
    <div
      role="img"
      aria-label={path.label}
      className="grid items-center gap-y-[9px] px-[70px]"
      style={gridColumns(stations.length)}
    >
      {labels}
      {track}
      {names}
    </div>
  );
}

// The compact path in a feed row: symbols joined by short colored lines.
export function MiniPath({ path }: { path: PathView }) {
  if (path.kind === 'none') {
    return <span className="text-[11px] font-bold text-text-3">{path.rowLabel}</span>;
  }
  return (
    <span
      role="img"
      aria-label={path.rowLabel}
      className="flex items-center gap-1.5 text-[11px] font-extrabold text-text-2"
    >
      {path.stations.map((station, index) => {
        const line = path.lines[index];
        return (
          <span key={index} className="contents">
            <span className={station.you ? 'text-you' : undefined}>{station.title}</span>
            {line && index < path.stations.length - 1 && (
              <span className={`block h-[3px] w-[22px] rounded-sm ${LINE_BG[line.kind]}`} />
            )}
          </span>
        );
      })}
    </span>
  );
}
