import { jsonTokens, type JsonTokenKind } from '../view/json';

const TOKEN_CLASS: Record<JsonTokenKind, string | undefined> = {
  key: 'text-supplier-light',
  string: 'text-code',
  number: 'text-model',
  literal: 'text-model',
  punct: undefined,
};

export function JsonBlock({ value, label }: { value: unknown; label: string }) {
  return (
    <pre
      aria-label={label}
      tabIndex={0}
      className="overflow-x-auto rounded-button border border-border bg-inset px-4 py-3.5 font-mono text-[12.5px] leading-[1.65] text-text focus-visible:outline-2 focus-visible:outline-you"
    >
      {jsonTokens(value).map((token, index) => (
        <span key={index} className={TOKEN_CLASS[token.kind]}>
          {token.text}
        </span>
      ))}
    </pre>
  );
}
