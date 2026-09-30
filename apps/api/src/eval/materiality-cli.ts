import { parseArgs } from 'node:util';
import { writeJson } from '../graph/json';
import { loadCandidates, loadReviews } from '../graph/review';
import {
  checkMateriality,
  loadMateriality,
  MATERIALITY_PATH,
  pendingEdges,
  recordFlag,
  reviewedEdges,
  type MaterialityLevel,
} from './materiality';
import { createPrompt, printable } from './prompt';

// npm run eval:materiality [-- --redo "<FROM type TO>"]
// Asks, for each direction of every reviewed edge, whether news about the from company is
// material to holders of the to company, and writes each answer to data/evals/materiality.json at
// once. A rerun asks only about the edges left; --redo asks about one edge again. For the eval
// only (T16 part 2): nothing in the product reads the file. No network, model or database.

const { values } = parseArgs({ options: { redo: { type: 'string' } } });

const edges = reviewedEdges(await loadCandidates(), await loadReviews());
let flags = await loadMateriality();
const problems = checkMateriality(flags, edges);
if (problems.length > 0) {
  console.error(
    `${MATERIALITY_PATH} does not match the reviewed edges:\n  ${problems.join('\n  ')}`,
  );
  process.exit(1);
}
if (values.redo !== undefined && !edges.some((e) => e.id === values.redo)) {
  console.error(`No reviewed edge "${values.redo}"; write it as "AMD supplier_of MSFT".`);
  process.exit(1);
}

const todo = pendingEdges(edges, flags, values.redo);
console.log(
  `${edges.length} directed edges (${edges.length / 2} relationships), ${flags.length} flagged, ${todo.length} to ask.`,
);
console.log(
  'major: news about the first company usually matters to holders of the second. minor: it rarely does.',
);

const ANSWERS: Record<string, MaterialityLevel | 'skip' | 'quit'> = {
  m: 'major',
  n: 'minor',
  s: 'skip',
  q: 'quit',
};

const prompt = createPrompt();
let quit = false;
for (const [i, edge] of todo.entries()) {
  if (quit) break;
  const current = flags.find((f) => f.edge === edge.id);
  console.log(
    [
      '',
      '-'.repeat(100),
      `[${i + 1}/${todo.length}] ${edge.id}${edge.seeded ? ' (seeded)' : ''}${current ? `, now ${current.level}` : ''}`,
      `Quote: ${printable(edge.quote)}`,
      `Filing: ${edge.url}`,
      '',
    ].join('\n'),
  );
  for (;;) {
    const answer = await prompt.ask(
      `Is news about ${edge.from} material to ${edge.to} holders? (m major, n minor, s skip, q quit): `,
    );
    const choice = answer === null ? 'quit' : ANSWERS[answer.trim().toLowerCase()];
    if (!choice) {
      console.log('Answer m, n, s or q.');
      continue;
    }
    if (choice === 'quit') quit = true;
    if (choice === 'major' || choice === 'minor') {
      flags = recordFlag(flags, {
        edge: edge.id,
        level: choice,
        decidedAt: new Date().toISOString(),
      });
      await writeJson(MATERIALITY_PATH, { flags });
      console.log(`${edge.id}: ${choice}.`);
    }
    break;
  }
}
prompt.close();

const minor = flags.filter((f) => f.level === 'minor').length;
console.log(
  `\n${flags.length - minor} major, ${minor} minor, ${pendingEdges(edges, flags).length} left. Flags are in ${MATERIALITY_PATH}.`,
);
