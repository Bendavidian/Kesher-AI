import type { PersonaLabels } from '../view/personas';
import type { ViewerKey } from '../view/types';

interface Props {
  personas: readonly PersonaLabels[];
  value: ViewerKey;
  onChange: (key: ViewerKey) => void;
}

// A demo control over the seeded users, not authentication (docs/UI.md, Copy rules). Choosing a
// persona signs in as that seeded user, so the api and the socket answer for it. Your portfolio
// opens the guest picker instead (T24).
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
