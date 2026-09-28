// Exploration: list news items for symbols in a window whose headline matches a pattern.
// Run: npx tsx research/events/search.ts <SYMBOLS|-> <start> <end> [headline regex]
// Example: npx tsx research/events/search.ts NVDA 2024-05-22 2024-05-24 "earnings|results"
// The window applies to updated_at, so a late update of an older item can appear in it.
import { news } from './alpaca';

const [symbols = '-', start, end, pattern = '.'] = process.argv.slice(2);
if (!start || !end) {
  console.error('usage: search.ts <SYMBOLS|-> <start> <end> [headline regex]');
  process.exit(1);
}

const match = new RegExp(pattern, 'i');
const items = await news({
  symbols: symbols === '-' ? undefined : symbols.split(','),
  start: new Date(start).toISOString(),
  end: new Date(end).toISOString(),
  max: 2000,
});
const hits = items.filter((n) => match.test(n.headline));
for (const n of hits) {
  const tags = n.symbols.join(',');
  const updated = n.updated_at === n.created_at ? '' : ` (updated ${n.updated_at})`;
  console.log(
    `${n.id}  ${n.created_at}${updated}  [${tags.length > 60 ? `${tags.slice(0, 60)}…` : tags}]  ${n.headline}`,
  );
}
console.log(`${hits.length} of ${items.length} items match`);
