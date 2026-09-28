import type { StepView } from '../view/run';
import { TONE_CLASS } from './stepTone';

interface MarkerProps {
  view: StepView;
  first: boolean;
  last: boolean;
  selected: boolean;
}

// The vertical line in the step's color, and its station.
function Marker({ view, first, last, selected }: MarkerProps) {
  const tone = TONE_CLASS[view.tone];
  const extent = first ? 'top-[13px] bottom-0' : last ? 'top-0 h-[19px]' : 'top-0 bottom-0';
  const station = selected
    ? `left-px top-2.5 size-[19px] border-4 ${tone.ring} ${tone.fill}`
    : `left-[3px] top-3 size-[15px] border-[3px] ${tone.ring} ${last ? tone.fill : 'bg-panel'}`;
  return (
    <span aria-hidden="true" className="relative block">
      <span
        data-testid="step-line"
        className={`absolute left-[9px] block w-[3px] ${extent} ${tone.line}`}
      />
      <span className={`absolute block rounded-full ${station}`} />
    </span>
  );
}

interface Props {
  steps: StepView[];
  selected: number;
  onSelect: (number: number) => void;
}

export function StepTimeline({ steps, selected, onSelect }: Props) {
  return (
    <ol aria-label="Run steps" className="flex flex-col p-2">
      {steps.map((view, index) => {
        const isSelected = view.number === selected;
        const tone = TONE_CLASS[view.tone];
        const tool = view.step.kind === 'tool';
        const title = tool
          ? `font-mono text-[13px] font-semibold ${isSelected ? tone.accent : ''}`
          : 'text-sm font-extrabold';
        return (
          <li key={view.number} aria-current={isSelected ? 'step' : undefined}>
            <button
              type="button"
              onClick={() => onSelect(view.number)}
              className={`grid min-h-11 w-full cursor-pointer grid-cols-[22px_minmax(0,1fr)_90px] gap-x-3 rounded-button px-3 text-left hover:bg-raised focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-you ${
                isSelected ? `bg-raised ring-1 ${tone.selected} ring-inset` : ''
              }`}
            >
              <Marker
                view={view}
                first={index === 0}
                last={index === steps.length - 1}
                selected={isSelected}
              />
              <span className="flex flex-col gap-px py-[9px]">
                <span className={title}>{view.step.name}</span>
                <span className={`text-xs ${isSelected ? 'text-text-2' : 'text-text-3'}`}>
                  {view.step.outputSummary}
                </span>
              </span>
              <span
                className={`flex flex-col py-2.5 text-right text-xs tabular-nums ${
                  isSelected ? `font-extrabold ${tone.accent}` : 'text-text-3'
                }`}
              >
                <span>{view.duration}</span>
                {view.tokens && <span>{view.tokens}</span>}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
