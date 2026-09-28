// SEC EDGAR access for the research scripts: the latest 10-K of a filer, cached on disk.
// Fair access: a User-Agent with a contact (SEC_USER_AGENT from .env, never printed) and at most
// 10 requests per second. Requests here run one at a time and at least 150 ms apart.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { z } from 'zod';

export const ROOT = resolve(import.meta.dirname, '..', '..');
export const CACHE = join(import.meta.dirname, 'cache');

const MIN_GAP_MS = 150;
let lastRequest = 0;
let agent: string | undefined;

function userAgent(): string {
  if (agent) return agent;
  const file = join(ROOT, '.env');
  if (existsSync(file)) process.loadEnvFile(file);
  const parsed = z.string().trim().min(1).safeParse(process.env.SEC_USER_AGENT);
  if (!parsed.success) throw new Error('SEC_USER_AGENT is not set in .env');
  agent = parsed.data;
  return agent;
}

async function get(url: string, accept: string): Promise<string> {
  const wait = lastRequest + MIN_GAP_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequest = Date.now();
  const res = await fetch(url, {
    headers: { 'User-Agent': userAgent(), Accept: accept },
    signal: AbortSignal.timeout(60_000),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return body;
}

const Submissions = z.object({
  name: z.string(),
  filings: z.object({
    recent: z.object({
      form: z.array(z.string()),
      accessionNumber: z.array(z.string()),
      filingDate: z.array(z.string()),
      reportDate: z.array(z.string()),
      primaryDocument: z.array(z.string()),
    }),
  }),
});

export interface Filing {
  filer: string;
  cik: string;
  form: '10-K';
  accession: string;
  filingDate: string;
  reportDate: string;
  url: string;
}

// The newest original 10-K in the filer's submissions (amendments are skipped).
export async function latest10K(cik: string): Promise<Filing> {
  const subs = Submissions.parse(
    JSON.parse(await get(`https://data.sec.gov/submissions/CIK${cik}.json`, 'application/json')),
  );
  const recent = subs.filings.recent;
  const i = recent.form.indexOf('10-K');
  const accession = recent.accessionNumber[i];
  const primary = recent.primaryDocument[i];
  if (i < 0 || !accession || !primary) throw new Error(`No 10-K in recent filings of CIK ${cik}`);
  return {
    filer: subs.name,
    cik,
    form: '10-K',
    accession,
    filingDate: recent.filingDate[i] ?? '',
    reportDate: recent.reportDate[i] ?? '',
    url: `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession.replace(/-/g, '')}/${primary}`,
  };
}

// The filing's primary document, from the cache when present. The .raw extension keeps
// Prettier (npm run lint) away from cached HTML.
export async function document(filing: Filing): Promise<{ html: string; cached: boolean }> {
  mkdirSync(CACHE, { recursive: true });
  const file = join(CACHE, `${filing.accession}.html.raw`);
  if (existsSync(file)) return { html: readFileSync(file, 'utf8'), cached: true };
  const html = await get(filing.url, 'text/html');
  writeFileSync(file, html);
  return { html, cached: false };
}
