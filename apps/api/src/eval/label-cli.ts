import { parseArgs } from 'node:util';
import { judgeRetrieval } from './judge-retrieval';
import { labelRelevance } from './label-relevance';
import { createPrompt } from './prompt';

// npm run eval:label [-- --redo <alpaca news id>]
// npm run eval:label -- --retrieval [--redo <query id>]
// The user's labels for the T16 evals, saved as soon as each is given; a rerun asks only about
// what is left, --redo asks about one item or query again. Relevance: high, medium or none per
// persona for each eval item, from committed recordings only. --retrieval: which of the first
// chunks of a filing search answer each query (reads Atlas and the cached embedding model).

const { values } = parseArgs({
  options: { redo: { type: 'string' }, retrieval: { type: 'boolean' } },
});

const prompt = createPrompt();
try {
  if (values.retrieval === true) await judgeRetrieval(prompt, values.redo);
  else await labelRelevance(prompt, values.redo);
} finally {
  prompt.close();
}
