import type { RunOption, StepTone } from '../view/run';

// Tailwind classes per timeline color (docs/UI.md, Agent run screen).
export const TONE_CLASS: Record<
  StepTone,
  { line: string; ring: string; fill: string; selected: string; chip: string; accent: string }
> = {
  code: {
    line: 'bg-code',
    ring: 'border-code',
    fill: 'bg-code',
    selected: 'ring-code/45',
    chip: 'bg-code-tint text-code',
    accent: 'text-code',
  },
  tool: {
    line: 'bg-supplier',
    ring: 'border-supplier',
    fill: 'bg-supplier',
    selected: 'ring-supplier/45',
    chip: 'bg-supplier-tint text-supplier',
    accent: 'text-supplier-light',
  },
  model: {
    line: 'bg-model',
    ring: 'border-model',
    fill: 'bg-model',
    selected: 'ring-model/45',
    chip: 'bg-model-tint text-model',
    accent: 'text-model',
  },
  removed: {
    line: 'bg-down',
    ring: 'border-down',
    fill: 'bg-down',
    selected: 'ring-down/45',
    chip: 'bg-down-tint text-down',
    accent: 'text-down',
  },
};

// Run status chips: completed green, failed red, anything else gray (docs/UI.md).
export const STATUS_CHIP: Record<RunOption['status']['tone'], string> = {
  up: 'bg-up-tint text-up',
  down: 'bg-down-tint text-down',
  neutral: 'bg-border text-text-2',
};
