import { EdgarFiling, FilingItemCode, type Company } from '@kesher/shared';
import { z } from 'zod';
import type { IncomingItem } from './item';

// The forms the live poller ingests: current reports and periodic reports, the same forms
// FilingChunk knows. Amendments (8-K/A) and ownership forms (3, 4, 144) are left out.
export const LIVE_FORMS = ['8-K', '10-Q', '10-K', '20-F', '6-K'] as const;
const LIVE_FORM_SET = new Set<string>(LIVE_FORMS);

// Fair access (docs/SPIKE.md check 1): a User-Agent with a contact, at most 10 requests per second.
const FETCH_TIMEOUT_MS = 10_000;
export const submissionsUrl = (cik: string) => `https://data.sec.gov/submissions/CIK${cik}.json`;

// The columns of filings.recent the poller reads. Each is one array, index aligned.
const Submissions = z.object({
  filings: z.object({
    recent: z.object({
      accessionNumber: z.array(z.string()),
      form: z.array(z.string()),
      filingDate: z.array(z.string()),
      acceptanceDateTime: z.array(z.string()),
      primaryDocument: z.array(z.string()),
      items: z.array(z.string()),
    }),
  }),
});

export type FilerRef = Pick<Company, 'symbol' | 'cik' | 'name'>;

export interface FetchFilingsOptions {
  userAgent: string;
  fetch?: typeof globalThis.fetch;
}

// EDGAR's item list, cut to well formed codes: anything else never reaches the title.
function itemCodes(items: string | undefined): string {
  return (items ?? '')
    .split(',')
    .map((code) => code.trim())
    .filter((code) => FilingItemCode.safeParse(code).success)
    .join(',');
}

// The filer's recent filings of the live forms, accepted at or after since. A row that fails
// the EdgarFiling schema is skipped, never guessed at.
export async function fetchRecentFilings(
  cik: string,
  since: Date,
  { userAgent, fetch = globalThis.fetch }: FetchFilingsOptions,
): Promise<EdgarFiling[]> {
  const response = await fetch(submissionsUrl(cik), {
    headers: { 'User-Agent': userAgent, Accept: 'application/json' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`EDGAR submissions for CIK ${cik} answered ${response.status}`);
  const { recent } = Submissions.parse(await response.json()).filings;
  const filings: EdgarFiling[] = [];
  recent.accessionNumber.forEach((accessionNumber, i) => {
    const form = recent.form[i];
    if (form === undefined || !LIVE_FORM_SET.has(form)) return;
    const row = EdgarFiling.safeParse({
      cik,
      accessionNumber,
      form,
      filingDate: recent.filingDate[i],
      acceptanceDateTime: recent.acceptanceDateTime[i],
      primaryDocument: recent.primaryDocument[i],
      items: itemCodes(recent.items[i]),
    });
    if (row.success && new Date(row.data.acceptanceDateTime) >= since) filings.push(row.data);
  });
  return filings;
}

// 8-K item labels (SEC Form 8-K General Instructions). The title is written by code from these,
// so the extraction reads what the filing is about without any filing text.
const ITEM_LABELS: Record<string, string> = {
  '1.01': 'Entry into a Material Definitive Agreement',
  '1.02': 'Termination of a Material Definitive Agreement',
  '1.03': 'Bankruptcy or Receivership',
  '1.05': 'Material Cybersecurity Incidents',
  '2.01': 'Completion of Acquisition or Disposition of Assets',
  '2.02': 'Results of Operations and Financial Condition',
  '2.03': 'Creation of a Direct Financial Obligation',
  '2.04': 'Triggering Events That Accelerate or Increase a Direct Financial Obligation',
  '2.05': 'Costs Associated with Exit or Disposal Activities',
  '2.06': 'Material Impairments',
  '3.01': 'Notice of Delisting or Failure to Satisfy a Continued Listing Rule',
  '3.02': 'Unregistered Sales of Equity Securities',
  '3.03': 'Material Modification to Rights of Security Holders',
  '4.01': "Changes in Registrant's Certifying Accountant",
  '4.02': 'Non-Reliance on Previously Issued Financial Statements',
  '5.01': 'Changes in Control of Registrant',
  '5.02': 'Departure or Appointment of Directors or Officers',
  '5.03': 'Amendments to Articles of Incorporation or Bylaws',
  '5.07': 'Submission of Matters to a Vote of Security Holders',
  '7.01': 'Regulation FD Disclosure',
  '8.01': 'Other Events',
  '9.01': 'Financial Statements and Exhibits',
};

const FORM_LABELS: Record<string, string> = {
  '10-Q': 'quarterly report',
  '10-K': 'annual report',
  '20-F': 'annual report',
  '6-K': 'report of a foreign private issuer',
};

export function filingTitle(filing: EdgarFiling, company: FilerRef): string {
  if (filing.form === '8-K') {
    // EdgarFiling allows only well formed codes, so an unknown one is digits and a dot.
    const items = filing.items
      .split(',')
      .filter((code) => code !== '')
      .map((code) => ITEM_LABELS[code] ?? `Item ${code}`);
    return items.length > 0
      ? `${company.name} 8-K: ${items.join('; ')}`
      : `${company.name} 8-K current report`;
  }
  return `${company.name} ${filing.form} ${FORM_LABELS[filing.form] ?? 'filing'}`;
}

export function filingUrl(filing: EdgarFiling): string {
  const folder = filing.accessionNumber.replaceAll('-', '');
  return `https://www.sec.gov/Archives/edgar/data/${Number(filing.cik)}/${folder}/${filing.primaryDocument}`;
}

// A filing is a primary source: Tier 1. symbols holds the filer's universe symbol, mapped from
// its CIK, so the pre filter passes it (SPEC.md Pipeline). text stays null, as for every filing.
export function toIncomingFiling(filing: EdgarFiling, company: FilerRef): IncomingItem {
  if (filing.cik !== company.cik) {
    throw new Error(`filing ${filing.accessionNumber} is not from CIK ${company.cik}`);
  }
  return {
    provider: 'sec_edgar',
    kind: 'filing',
    tier: 1,
    externalId: filing.accessionNumber,
    url: filingUrl(filing),
    author: null,
    publisher: null,
    title: filingTitle(filing, company),
    text: null,
    symbols: [company.symbol],
    publishedAt: new Date(filing.acceptanceDateTime),
  };
}
