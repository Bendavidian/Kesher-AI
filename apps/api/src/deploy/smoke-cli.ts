import { parseArgs } from 'node:util';
import { formatResult, passed, runSmoke } from './smoke';

// npm run smoke -- --url <base url> [--no-investigate]
// The deploy smoke test against a running app, locally or on the host: health, the web shell,
// closed dev routes, sign in for A, B and C with sockets, the demo replay and its live pushes,
// the three persona levels, the price reaction, then Investigate and its run and report.
// Investigate spends one research run of the day's budget; --no-investigate leaves it out.

const { values } = parseArgs({
  options: {
    url: { type: 'string' },
    'no-investigate': { type: 'boolean', default: false },
  },
});
if (!values.url || !/^https?:\/\//.test(values.url)) {
  console.error('Usage: npm run smoke -- --url <http(s) base url> [--no-investigate]');
  process.exit(2);
}

console.log(`Smoke test against ${values.url}`);
const results = await runSmoke(values.url, {
  investigate: !values['no-investigate'],
  log: (result) => console.log(formatResult(result)),
});
const ok = passed(results);
console.log(ok ? 'Smoke test passed.' : 'Smoke test failed.');
process.exit(ok ? 0 : 1);
