import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { DEMO_PERSONAS, UNIVERSE, type PersonaKey } from '@kesher/shared';
import { writeJson } from '../graph/json';
import { loadRecording } from '../ingest/recordings';
import { PERSONAS } from '../seed/config';
import { loadEvents } from './dataset';
import {
  checkLabels,
  LABELS_PATH,
  loadLabels,
  parseLevel,
  pendingItems,
  PERSONA_KEYS,
  recordReview,
  type Label,
  type Level,
} from './labels';

// npm run eval:label [-- --redo <alpaca news id>]
// Shows each eval item as recorded, headline, time, symbols and summary, and asks for high,
// medium or none per persona. The proposed label is never shown, so it cannot anchor the answer.
// Each item's three answers are written to data/evals/labels.json as soon as they are given; a
// rerun asks only about items not yet reviewed, --redo asks about one item again. Reads only
// committed files: no network, no model, no database.

const { values } = parseArgs({ options: { redo: { type: 'string' } } });

const events = await loadEvents();
let labels: Label[] = await loadLabels();
const problems = checkLabels(events, labels);
if (problems.length > 0) {
  console.error(
    `data/evals/labels.json does not match data/evals/events.json:\n  ${problems.join('\n  ')}`,
  );
  process.exit(1);
}
if (values.redo !== undefined && !events.some((e) => e.id === values.redo)) {
  console.error(`No eval item ${values.redo}.`);
  process.exit(1);
}

const universe = new Set<string>(UNIVERSE);
const holdings = (key: PersonaKey) =>
  PERSONAS.find((p) => p.email === DEMO_PERSONAS.find((d) => d.key === key)!.email)!
    .holdings.map((h) => h.symbol)
    .join(', ');
// Provider text is printed as data: control characters other than the newline are dropped, so
// escape sequences in a recording never reach the terminal.
// eslint-disable-next-line no-control-regex
const printable = (text: string) => text.replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g, '');

const todo = pendingItems(events, labels, values.redo);
const reviewedCount = () => labels.filter((l) => l.status === 'reviewed').length;
console.log(
  `${events.length} items, ${reviewedCount()} of ${labels.length} labels reviewed, ${todo.length} items to label.`,
);
console.log(
  'For each persona: h high, m medium, n none. s skips the item, q quits. Answers are saved per item.',
);

// Answers are read as lines, so piped input works too; the end of input counts as quit.
const rl = createInterface({ input: process.stdin, terminal: false });
const lines = rl[Symbol.asyncIterator]();
const ask = async (prompt: string): Promise<string | null> => {
  process.stdout.write(prompt);
  const next = await lines.next();
  return next.done === true ? null : String(next.value);
};

let quit = false;
for (const [i, event] of todo.entries()) {
  if (quit) break;
  const recording = await loadRecording(event.id);
  if (!recording) {
    console.error(
      `No recording for ${event.id}; run npm run record for it (see data/evals/events.json).`,
    );
    process.exit(1);
  }
  const { item } = recording;
  const symbols = item.symbols.map((s) => (universe.has(s) ? `${s}*` : s)).join(', ');
  console.log(`\n${'-'.repeat(100)}\n[${i + 1}/${todo.length}] ${event.id}, ${item.created_at}`);
  console.log(
    `${printable(item.headline)}\nSymbols: ${printable(symbols)} (* in the demo universe)`,
  );
  const summary = printable(item.summary).trim();
  console.log(`\n${summary === '' ? '(no summary)' : summary}\n`);

  const answers: Partial<Record<PersonaKey, Level>> = {};
  for (const persona of PERSONA_KEYS) {
    for (;;) {
      const answer = await ask(`Persona ${persona} (${holdings(persona)}): `);
      const input = answer === null ? ({ kind: 'quit' } as const) : parseLevel(answer);
      if (input === null) {
        console.log('Answer h, m, n, s or q.');
        continue;
      }
      if (input.kind === 'level') answers[persona] = input.level;
      else if (input.kind === 'quit') quit = true;
      break;
    }
    if (answers[persona] === undefined) break;
  }
  const { A, B, C } = answers;
  if (A && B && C) {
    labels = recordReview(labels, event.id, { A, B, C }, new Date());
    await writeJson(LABELS_PATH, { labels });
    console.log(`Saved ${event.id}: A ${A}, B ${B}, C ${C}.`);
  } else if (!quit) {
    console.log(`Skipped ${event.id}; nothing saved.`);
  }
}
rl.close();

const left = pendingItems(events, labels).length;
console.log(`\n${reviewedCount()} of ${labels.length} labels reviewed, ${left} items left.`);
