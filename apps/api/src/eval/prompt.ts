import { createInterface } from 'node:readline/promises';

// Control characters other than the newline are dropped before provider or filing text is
// printed, so escape sequences in a recording never reach the terminal.
export const printable = (text: string) =>
  // eslint-disable-next-line no-control-regex
  text.replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g, '');

export interface Prompt {
  // null at the end of input, which the callers treat as quit.
  ask: (question: string) => Promise<string | null>;
  close: () => void;
}

// Answers are read as lines, so piped input works too.
export function createPrompt(): Prompt {
  const rl = createInterface({ input: process.stdin, terminal: false });
  const lines = rl[Symbol.asyncIterator]();
  return {
    async ask(question) {
      process.stdout.write(question);
      const next = await lines.next();
      return next.done === true ? null : String(next.value);
    },
    close: () => rl.close(),
  };
}
