import { PROVIDER_LABEL, TONE_LABEL, type OutputView, type StepView } from '../view/run';
import type { RunTokenScope } from '../view/types';
import { JsonBlock } from './JsonBlock';
import { TONE_CLASS } from './stepTone';

const CHIP_LABEL: Record<StepView['tone'], string> = { ...TONE_LABEL, removed: 'Check' };

// What the run token allowed the call. The user never comes from the agent (principle 5).
function AccessBlock({ scope }: { scope: RunTokenScope }) {
  return (
    <section
      aria-labelledby="access-title"
      className="flex flex-col gap-3 rounded-panel border border-border bg-inset px-[18px] py-4"
    >
      <h3 id="access-title" className="text-[13px] font-extrabold text-text-2">
        Access for this call
      </h3>
      <dl className="grid grid-cols-[120px_minmax(0,1fr)] items-start gap-x-3.5 gap-y-[11px] text-[13px] leading-normal">
        <dt className="text-text-3">User</dt>
        <dd>Taken from your sign in, never from the agent.</dd>
        <dt className="text-text-3">Allowed tools</dt>
        <dd>
          <ul aria-label="Allowed tools" className="flex flex-wrap gap-1.5">
            {scope.tools.map((tool) => (
              <li
                key={tool}
                className="rounded-[5px] bg-supplier-tint px-2 py-0.5 font-mono text-[11.5px] font-semibold text-supplier-light"
              >
                {tool}
              </li>
            ))}
          </ul>
        </dd>
        <dt className="text-text-3">Writes</dt>
        <dd>None. Every tool this agent holds is read only.</dd>
        <dt className="text-text-3">Expires</dt>
        <dd>{scope.ttlMinutes} minutes after the run starts.</dd>
      </dl>
      <p className="border-t border-border pt-3 text-xs leading-normal text-text-2">
        No tool takes a user argument, so the agent can&apos;t ask for anyone else&apos;s data.
      </p>
    </section>
  );
}

interface Props {
  view: StepView;
  total: number;
  output: OutputView;
  scope: RunTokenScope | null;
  className?: string;
}

export function StepDetail({ view, total, output, scope, className = '' }: Props) {
  const { step } = view;
  const tone = TONE_CLASS[view.tone];
  const tool = step.kind === 'tool';
  const position = `Step ${view.number} of ${total}`;

  return (
    <section
      aria-label={`${position}: ${step.name}`}
      className={`flex flex-col gap-4 rounded-panel border border-border bg-panel px-[22px] py-[18px] ${className}`}
    >
      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-text-3">{position}</span>
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <h2
            className={
              tool
                ? 'font-mono text-[22px] font-semibold text-supplier-light'
                : 'text-[22px] font-extrabold'
            }
          >
            {step.name}
          </h2>
          <span className={`rounded-[5px] px-2 py-[3px] text-[11px] font-extrabold ${tone.chip}`}>
            {CHIP_LABEL[view.tone]}
          </span>
          <span className="text-[13px] text-text-2 tabular-nums">{view.duration}</span>
        </div>
        {step.kind === 'model' && (
          <div className="flex flex-wrap gap-x-4 text-xs text-text-2 tabular-nums">
            <span>
              {PROVIDER_LABEL[step.provider]}, {step.model}
            </span>
            <span>
              {step.tokens.total.toLocaleString('en-US')} tokens:{' '}
              {step.tokens.input.toLocaleString('en-US')} in,{' '}
              {step.tokens.output.toLocaleString('en-US')} out
            </span>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-[13px] font-extrabold text-text-2">Input</h3>
        <JsonBlock value={step.input} label="Step input" />
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-[13px] font-extrabold text-text-2">
          {output.format !== 'none' && output.note ? `Output, ${output.note}` : 'Output'}
        </h3>
        {/* Output may quote untrusted text; it is rendered as text only, never as markup. */}
        {output.format === 'json' && <JsonBlock value={output.value} label="Step output" />}
        {output.format === 'text' && (
          <pre
            aria-label="Step output"
            tabIndex={0}
            className="overflow-x-auto rounded-button border border-border bg-inset px-4 py-3.5 font-mono text-[12.5px] leading-[1.65] whitespace-pre-wrap text-text focus-visible:outline-2 focus-visible:outline-you"
          >
            {output.text}
          </pre>
        )}
        <p className="rounded-button border border-border bg-inset px-4 py-3.5 text-[13px] leading-normal text-text-2">
          {step.outputSummary}
        </p>
      </div>

      {/* Only tool calls go through the run token; model and code steps do not use it. */}
      {tool && scope && <AccessBlock scope={scope} />}
    </section>
  );
}
