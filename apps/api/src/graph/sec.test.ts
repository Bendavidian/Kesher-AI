import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { filingHtml, findAnnual, latestAnnual, type Fetcher } from './sec';

const submissions = (rows: { form: string; accession: string }[]) =>
  JSON.stringify({
    filings: {
      recent: {
        form: rows.map((r) => r.form),
        accessionNumber: rows.map((r) => r.accession),
        filingDate: rows.map(() => '2026-02-25'),
        reportDate: rows.map(() => '2026-01-25'),
        acceptanceDateTime: rows.map(() => '2026-02-25T21:42:19.000Z'),
        primaryDocument: rows.map((r) => `${r.accession}.htm`),
      },
    },
  });

describe('latestAnnual', () => {
  it('takes the newest original report of the form and skips amendments', () => {
    const json = submissions([
      { form: '8-K', accession: '0001045810-26-000030' },
      { form: '10-K/A', accession: '0001045810-26-000025' },
      { form: '10-K', accession: '0001045810-26-000021' },
      { form: '10-K', accession: '0001045810-25-000023' },
    ]);
    expect(latestAnnual(json, '0001045810', '10-K')).toEqual({
      cik: '0001045810',
      form: '10-K',
      accession: '0001045810-26-000021',
      filingDate: '2026-02-25',
      reportDate: '2026-01-25',
      acceptedAt: '2026-02-25T21:42:19.000Z',
      url: 'https://www.sec.gov/Archives/edgar/data/1045810/000104581026000021/0001045810-26-000021.htm',
    });
  });

  it('rejects an entry whose accession or document could escape the cache or the URL', () => {
    const json = submissions([{ form: '10-K', accession: '../../x' }]);
    expect(() => latestAnnual(json, '0001045810', '10-K')).toThrow(
      'invalid 10-K entry for CIK 0001045810: accession, primary',
    );
  });

  it('returns null when the filer has no report of that form', () => {
    expect(
      latestAnnual(submissions([{ form: '10-Q', accession: 'x' }]), '0000000001', '20-F'),
    ).toBeNull();
  });
});

describe('findAnnual', () => {
  it('falls back to the next CIK when the first has no report yet', async () => {
    const asked: string[] = [];
    const get: Fetcher = (url) => {
      asked.push(url);
      return Promise.resolve(
        url.includes('0002115436')
          ? submissions([{ form: '8-K', accession: 'a' }])
          : submissions([{ form: '10-K', accession: '0000034088-26-000045' }]),
      );
    };
    const filing = await findAnnual(get, ['0002115436', '0000034088'], '10-K');
    expect(filing.cik).toBe('0000034088');
    expect(asked).toEqual([
      'https://data.sec.gov/submissions/CIK0002115436.json',
      'https://data.sec.gov/submissions/CIK0000034088.json',
    ]);
  });

  it('fails naming the CIKs when none has a report', async () => {
    const get: Fetcher = () => Promise.resolve(submissions([]));
    await expect(findAnnual(get, ['0000000001', '0000000002'], '10-K')).rejects.toThrow(
      'no 10-K for CIK 0000000001 or 0000000002',
    );
  });
});

describe('filingHtml', () => {
  let dir: string | undefined;
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('fetches once, then reads the cache', async () => {
    dir = await mkdtemp(join(tmpdir(), 'kesher-sec-'));
    let calls = 0;
    const get: Fetcher = () => {
      calls++;
      return Promise.resolve('<p>body</p>');
    };
    const filing = latestAnnual(
      submissions([{ form: '10-K', accession: '0000002488-26-000018' }]),
      '0000002488',
      '10-K',
    );
    if (!filing) throw new Error('no filing');
    expect(await filingHtml(get, filing, dir)).toEqual({ html: '<p>body</p>', cached: false });
    expect(await filingHtml(get, filing, dir)).toEqual({ html: '<p>body</p>', cached: true });
    expect(calls).toBe(1);
    expect(await readFile(join(dir, '0000002488-26-000018.html.raw'), 'utf8')).toBe('<p>body</p>');
  });
});
