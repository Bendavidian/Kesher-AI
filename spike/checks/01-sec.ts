// SEC: NVIDIA's latest 10-K through the submissions API; locate the TSMC foundry passage.
import { http, type Check } from '../lib.ts';

const NVIDIA_CIK = '0001045810';

export function htmlToText(html: string): string {
  return html
    .replace(/<ix:header>[\s\S]*?<\/ix:header>/gi, ' ')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&rsquo;/g, '’')
    .replace(/&ldquo;/g, '“')
    .replace(/&rdquo;/g, '”')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/[ \s]+/g, ' ')
    .trim();
}

const check: Check = {
  name: 'sec',
  title: 'SEC EDGAR: NVIDIA 10-K and the TSMC foundry passage',
  keys: ['SEC_USER_AGENT'],
  async run(ctx) {
    const headers = { 'User-Agent': ctx.env('SEC_USER_AGENT')!, Accept: 'application/json, text/html' };
    const limits = [
      'SEC fair access: at most 10 requests per second, and a User-Agent with a contact email is required.',
    ];

    const subs = await http<any>(`https://data.sec.gov/submissions/CIK${NVIDIA_CIK}.json`, { headers });
    const recent = subs.body.filings.recent;
    const i = (recent.form as string[]).indexOf('10-K');
    if (i < 0) return { status: 'fail', reason: 'No 10-K in recent filings', evidence: {}, limits };

    const accession: string = recent.accessionNumber[i];
    const primaryDocument: string = recent.primaryDocument[i];
    const url = `https://www.sec.gov/Archives/edgar/data/${Number(NVIDIA_CIK)}/${accession.replace(/-/g, '')}/${primaryDocument}`;
    ctx.log(`latest 10-K ${accession}, filed ${recent.filingDate[i]}`);

    const doc = await http<string>(url, { headers, as: 'text', timeoutMs: 60_000 });
    const text = htmlToText(doc.body);
    const sentences = text.split(/(?<=[.!?])\s+(?=[A-Z])/);
    const tsmc = (s: string) => /\bTSMC\b|Taiwan Semiconductor/.test(s);
    const passage =
      sentences.find((s) => tsmc(s) && /foundr/i.test(s)) ?? sentences.find((s) => tsmc(s));
    const mentions = sentences.filter(tsmc).length;

    const evidence = {
      company: subs.body.name,
      form: '10-K',
      accessionNumber: accession,
      filingDate: recent.filingDate[i],
      reportDate: recent.reportDate[i],
      url,
      submissionsMs: subs.ms,
      documentMs: doc.ms,
      documentBytes: doc.body.length,
      textChars: text.length,
      sentencesMentioningTsmc: mentions,
      quote: passage ? passage.slice(0, 400) : null,
      quoteFoundVerbatim: passage ? text.includes(passage.slice(0, 400)) : false,
    };
    if (!passage) return { status: 'fail', reason: 'No sentence mentions TSMC', evidence, limits };
    return { status: 'pass', evidence, limits };
  },
};

export default check;
