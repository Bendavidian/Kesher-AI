import { describe, expect, it } from 'vitest';
import { SecHttpError, type Fetcher } from './fetch';
import {
  conceptUrl,
  createCompanyConcepts,
  parseCompanyConcept,
  recordedConcepts,
  secConcepts,
} from './xbrl';

describe('the recorded NVDA facts', () => {
  const read = recordedConcepts();

  it('parse into concept facts with the CIK padded and frames kept', async () => {
    const facts = parseCompanyConcept((await read('NVDA', 'Revenues'))!);
    expect(facts).toMatchObject({ cik: '0001045810', concept: 'Revenues' });
    const usd = facts.units.USD ?? [];
    expect(usd.length).toBeGreaterThan(10);
    expect(usd.every((fact) => fact.frame !== null)).toBe(true);
  });

  it('record a concept NVDA does not report as null, and refuse one never recorded', async () => {
    expect(await read('NVDA', 'SalesRevenueNet')).toBeNull();
    await expect(read('KO', 'Revenues')).rejects.toThrow('no XBRL recording for KO Revenues');
  });
});

describe('secConcepts', () => {
  it('tries the next CIK on a 404 and answers null when every CIK has none', async () => {
    const asked: string[] = [];
    const get: Fetcher = (url) => {
      asked.push(url);
      return url.includes('CIK0000034088')
        ? Promise.resolve('{"ok":true}')
        : Promise.reject(new SecHttpError(404, url));
    };
    // XOM's seeded CIK is the new holding company; the old one holds its filings.
    expect(await secConcepts(() => get)('XOM', 'Revenues')).toBe('{"ok":true}');
    expect(asked).toEqual([
      conceptUrl('0002115436', 'Revenues'),
      conceptUrl('0000034088', 'Revenues'),
    ]);
    expect(await secConcepts(() => get)('NVDA', 'Revenues')).toBeNull();
  });

  it('passes any other failure on', async () => {
    const get: Fetcher = (url) => Promise.reject(new SecHttpError(503, url));
    await expect(secConcepts(() => get)('NVDA', 'Revenues')).rejects.toThrow('HTTP 503');
  });
});

describe('createCompanyConcepts', () => {
  const json = JSON.stringify({ cik: 1045810, taxonomy: 'us-gaap', tag: 'Revenues', units: {} });

  it('asks once per concept within 12 hours, and again after', async () => {
    let calls = 0;
    let now = 0;
    const source = createCompanyConcepts(
      () => {
        calls++;
        return Promise.resolve(json);
      },
      () => now,
    );
    await source('NVDA', 'Revenues');
    await source('NVDA', 'Revenues');
    expect(calls).toBe(1);
    now = 12 * 60 * 60 * 1000;
    await source('NVDA', 'Revenues');
    expect(calls).toBe(2);
  });

  it('does not keep a failure, and rejects an answer that is not a us-gaap concept', async () => {
    let fail = true;
    const source = createCompanyConcepts(() =>
      fail ? Promise.reject(new Error('down')) : Promise.resolve(json),
    );
    await expect(source('NVDA', 'Revenues')).rejects.toThrow('down');
    fail = false;
    await expect(source('NVDA', 'Revenues')).resolves.toMatchObject({ concept: 'Revenues' });
    const bad = createCompanyConcepts(() => Promise.resolve('{"taxonomy":"ifrs-full"}'));
    await expect(bad('NVDA', 'Revenues')).rejects.toThrow();
  });
});
