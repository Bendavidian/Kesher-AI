import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import type { Fetcher } from '../sec/fetch';

// SEC EDGAR access for the graph build job: the latest annual report of a filer, cached on disk.
// Requests go through secFetcher (sec/fetch.ts), which keeps to SEC fair access.

// The repo root .cache/sec, gitignored. The .raw extension keeps Prettier away from cached HTML.
export const SEC_CACHE_DIR = resolve(import.meta.dirname, '../../../../.cache/sec');

export type AnnualForm = '10-K' | '20-F';

export interface Filing {
  cik: string;
  form: AnnualForm;
  accession: string;
  // The official EDGAR filing date, used as evidence.filingDate.
  filingDate: string;
  // The end of the fiscal period the report covers.
  reportDate: string;
  // EDGAR acceptance time, used as Source.publishedAt.
  acceptedAt: string;
  url: string;
}

// Only the entry that is used gets validated; the arrays hold every recent filing.
const Submissions = z.object({
  filings: z.object({
    recent: z.object({
      form: z.array(z.string()),
      accessionNumber: z.array(z.string()),
      filingDate: z.array(z.string()),
      reportDate: z.array(z.string()),
      acceptanceDateTime: z.array(z.string()),
      primaryDocument: z.array(z.string()),
    }),
  }),
});

// The accession names the cache file and the document ends the URL, so both are checked before
// either is used.
const Entry = z.strictObject({
  accession: z.string().regex(/^\d{10}-\d{2}-\d{6}$/),
  primary: z.string().regex(/^[\w.-]+\.html?$/),
  filingDate: z.iso.date(),
  reportDate: z.iso.date(),
  acceptedAt: z.iso.datetime({ offset: true }),
});

const Cik = z.string().regex(/^\d{10}$/);

// The newest original annual report of that form in the submissions (amendments are skipped:
// they carry a different form, 10-K/A or 20-F/A). null when the filer has none yet.
export function latestAnnual(
  submissionsJson: string,
  cik: string,
  form: AnnualForm,
): Filing | null {
  Cik.parse(cik);
  const recent = Submissions.parse(JSON.parse(submissionsJson)).filings.recent;
  const i = recent.form.indexOf(form);
  if (i < 0) return null;
  const entry = Entry.safeParse({
    accession: recent.accessionNumber[i],
    primary: recent.primaryDocument[i],
    filingDate: recent.filingDate[i],
    reportDate: recent.reportDate[i],
    acceptedAt: recent.acceptanceDateTime[i],
  });
  if (!entry.success) {
    const fields = [...new Set(entry.error.issues.map((issue) => issue.path.join('.')))];
    throw new Error(`invalid ${form} entry for CIK ${cik}: ${fields.join(', ')}`);
  }
  const { accession, primary, filingDate, reportDate, acceptedAt } = entry.data;
  return {
    cik,
    form,
    accession,
    filingDate,
    reportDate,
    acceptedAt: new Date(acceptedAt).toISOString(),
    url: `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession.replaceAll('-', '')}/${primary}`,
  };
}

// The latest annual report, trying each CIK in order: SEC now maps XOM to a new holding company
// CIK that may have no 10-K yet, so the old CIK is the fallback (BACKLOG.md T11).
export async function findAnnual(
  get: Fetcher,
  ciks: readonly string[],
  form: AnnualForm,
): Promise<Filing> {
  for (const cik of ciks) {
    const json = await get(`https://data.sec.gov/submissions/CIK${cik}.json`, 'application/json');
    const filing = latestAnnual(json, cik, form);
    if (filing) return filing;
  }
  throw new Error(`no ${form} for CIK ${ciks.join(' or ')}`);
}

// The filing's primary document, from the cache when present. The cache file is written under a
// temporary name and renamed, so an interrupted download never leaves a truncated file behind.
export async function filingHtml(
  get: Fetcher,
  filing: Filing,
  dir = SEC_CACHE_DIR,
): Promise<{ html: string; cached: boolean }> {
  const file = join(dir, `${filing.accession}.html.raw`);
  if (existsSync(file)) return { html: await readFile(file, 'utf8'), cached: true };
  const html = await get(filing.url, 'text/html');
  await mkdir(dir, { recursive: true });
  await writeFile(`${file}.part`, html);
  await rename(`${file}.part`, file);
  return { html, cached: false };
}
