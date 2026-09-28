// Runs the T00 checks in order. A failure or a missing key never stops the next check.
// ONLY=sec,finnhub runs a subset. Results: spike/output/<check>.json and spike/output/summary.json.
import { envValue, errorMessage, loadEnv, makeCtx, writeJson, type Check, type CheckResult } from './lib.ts';
import sec from './checks/01-sec.ts';
import finnhub from './checks/02-finnhub.ts';
import alpaca from './checks/03-alpaca.ts';
import groq from './checks/04-groq.ts';
import gemini from './checks/05-gemini.ts';
import embeddings from './checks/06-embeddings.ts';
import atlas from './checks/07-atlas.ts';

const CHECKS: Check[] = [sec, finnhub, alpaca, groq, gemini, embeddings, atlas];

loadEnv();
const only = new Set((process.env.ONLY ?? '').split(',').map((s) => s.trim()).filter(Boolean));
const results: CheckResult[] = [];

for (const check of CHECKS) {
  if (only.size && !only.has(check.name)) continue;
  console.log(`\n▶ ${check.title}`);
  const ranAt = new Date().toISOString();
  const started = performance.now();
  let result: CheckResult;
  const missing = check.keys.filter((k) => !envValue(k));
  if (missing.length) {
    result = {
      check: check.name, title: check.title, status: 'skipped', reason: `skipped: missing key ${missing.join(', ')}`,
      evidence: {}, limits: [], ms: 0, ranAt,
    };
  } else {
    try {
      const outcome = await check.run(makeCtx(check.name));
      result = { check: check.name, title: check.title, ...outcome, ms: Math.round(performance.now() - started), ranAt };
    } catch (err) {
      result = {
        check: check.name, title: check.title, status: 'fail', reason: errorMessage(err),
        evidence: {}, limits: [], ms: Math.round(performance.now() - started), ranAt,
      };
    }
  }
  writeJson(check.name, result);
  results.push(result);
  console.log(`  ${result.status.toUpperCase()}${result.reason ? `: ${result.reason}` : ''} (${result.ms} ms)`);
}

writeJson('summary', results.map(({ check, status, reason, ms, ranAt }) => ({ check, status, reason, ms, ranAt })));
console.log('\nSummary');
console.table(results.map(({ check, status, reason, ms }) => ({ check, status, ms, reason: reason ?? '' })));
process.exitCode = results.some((r) => r.status === 'fail') ? 1 : 0;
