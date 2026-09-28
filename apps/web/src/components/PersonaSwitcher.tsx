import type { Persona, PersonaKey } from '../view/types';

interface Props {
  personas: Persona[];
  value: PersonaKey;
  onChange: (key: PersonaKey) => void;
}

// A demo control over the seeded users, not authentication (docs/UI.md, Copy rules).
export function PersonaSwitcher({ personas, value, onChange }: Props) {
  return (
    <div className="flex items-center gap-2.5">
      <span id="persona-label" className="text-xs whitespace-nowrap text-text-3">
        Viewing as
      </span>
      <div
        role="group"
        aria-labelledby="persona-label"
        className="flex gap-1 rounded-panel border border-border bg-inset p-[3px]"
      >
        {personas.map((persona) => {
          const pressed = persona.key === value;
          return (
            <button
              key={persona.key}
              type="button"
              aria-pressed={pressed}
              title={persona.displayName}
              onClick={() => onChange(persona.key)}
              className={`h-11 cursor-pointer rounded-button border px-3.5 text-[13px] font-bold whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-you ${
                pressed
                  ? 'border-you bg-you text-on-you'
                  : 'border-transparent text-text-2 hover:text-text'
              }`}
            >
              {persona.switcherLabel}
            </button>
          );
        })}
      </div>
    </div>
  );
}
