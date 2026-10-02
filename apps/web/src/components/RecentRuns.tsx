import { Select } from '@mantine/core';
import { useNavigate } from 'react-router';
import { runPath } from '../routes';
import type { RunOption } from '../view/run';
import { STATUS_CHIP } from './stepTone';

interface Props {
  options: RunOption[];
  currentId: string;
}

// The Recent runs selector in the run screen header (docs/UI.md, Agent run screen), a Mantine
// Select since T29: the signed in user's runs from GET /runs, newest first; choosing one opens it.
export function RecentRuns({ options, currentId }: Props) {
  const navigate = useNavigate();
  if (options.length === 0) return null;
  const byId = new Map(options.map((option) => [option.id, option]));

  return (
    <Select
      aria-label="Recent runs"
      placeholder={`Recent runs (${options.length})`}
      data={options.map((option) => ({
        value: option.id,
        label: `${option.time} · ${option.label}`,
      }))}
      value={byId.has(currentId) ? currentId : null}
      allowDeselect={false}
      onChange={(id) => {
        if (id && id !== currentId) void navigate(runPath(id));
      }}
      maxDropdownHeight={360}
      comboboxProps={{ width: 380, position: 'bottom-end', offset: 6 }}
      renderOption={({ option }) => {
        const run = byId.get(option.value);
        if (!run) return option.label;
        return (
          <span className="flex w-full items-center gap-3">
            <span className="shrink-0 text-xs text-text-3 tabular-nums">{run.time}</span>
            <span className="min-w-0 grow truncate font-bold text-text">{run.label}</span>
            <span
              className={`shrink-0 rounded-chip px-2 py-0.5 text-[11px] font-extrabold ${STATUS_CHIP[run.status.tone]}`}
            >
              {run.status.label}
            </span>
          </span>
        );
      }}
      className="w-[260px] max-w-full shrink"
      classNames={{
        input:
          'h-11 rounded-button border-border-strong bg-panel text-[13px] font-bold text-text hover:bg-raised focus:border-you',
        section: 'text-text-2',
        dropdown:
          'max-w-[calc(100vw-32px)] rounded-panel border border-border-strong bg-panel p-1.5',
        option:
          'min-h-11 rounded-button px-3 py-1.5 text-[13px] hover:bg-raised data-[combobox-selected]:bg-raised data-[checked]:bg-raised',
      }}
    />
  );
}
