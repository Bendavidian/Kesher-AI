import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { writeJson } from './json';
import {
  groupRelationships,
  loadCandidates,
  loadReviews,
  parseInput,
  pending,
  record,
  renderGroup,
  REVIEWS_PATH,
  staleReviews,
  type Review,
} from './review';

// npm run graph:review [-- --redo <key>]
// Shows every proposed relationship with each supporting quote and its URL, and records the
// user's decision in data/graph/reviews.json as soon as it is made. A rerun asks only about the
// relationships not yet decided; --redo asks about one decided relationship again. Reads only
// committed files: no network, no model, no database.

const { values } = parseArgs({ options: { redo: { type: 'string' } } });

const groups = groupRelationships(await loadCandidates());
let reviews: Review[] = await loadReviews();
const stale = staleReviews(groups, reviews);
if (stale.length > 0) {
  console.error(
    `data/graph/reviews.json no longer matches data/graph/candidates.json:\n${stale.map((p) => `  ${p}`).join('\n')}\nRemove those entries from data/graph/reviews.json, then run the review again to decide them anew.`,
  );
  process.exit(1);
}
if (values.redo !== undefined && !groups.some((g) => g.key === values.redo)) {
  console.error(`No proposed relationship ${values.redo}.`);
  process.exit(1);
}

const todo = pending(groups, reviews, values.redo);
const decided = groups.length - pending(groups, reviews).length;
console.log(
  `${groups.length} relationships proposed, ${decided} decided, ${todo.length} to review. Seeded edges are not shown.`,
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
for (const [i, group] of todo.entries()) {
  if (quit) break;
  console.log(
    `\n${'-'.repeat(100)}\n${renderGroup(group, `[${i + 1}/${todo.length} to review]`)}\n`,
  );
  for (;;) {
    const answer = await ask('Decision (number, number+, r reject, s skip, q quit): ');
    const input =
      answer === null ? ({ kind: 'quit' } as const) : parseInput(group, answer, new Date());
    if (input.kind === 'invalid') {
      console.log(input.message);
      continue;
    }
    if (input.kind === 'quit') quit = true;
    if (input.kind === 'review') {
      reviews = record(reviews, input.review);
      await writeJson(REVIEWS_PATH, { reviews });
      console.log(
        input.review.decision === 'accept'
          ? `Accepted ${input.review.key} with evidence from ${input.review.rowId}.`
          : `Rejected ${input.review.key}.`,
      );
    }
    break;
  }
}
rl.close();

const accepted = reviews.filter((r) => r.decision === 'accept').length;
const rejected = reviews.length - accepted;
const left = pending(groups, reviews).length;
console.log(
  `\n${accepted} accepted, ${rejected} rejected, ${left} left.${reviews.length > 0 ? ` Decisions are in ${REVIEWS_PATH}.` : ''}`,
);
