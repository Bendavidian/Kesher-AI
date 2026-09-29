import { randomUUID } from 'node:crypto';
import { Claim } from '@kesher/shared';
import { describe, expect, it } from 'vitest';
import { checkDraft, type SeenSource } from './checks';
import type { DraftClaim, ReportDraft } from './draft';

const news: SeenSource = {
  _id: randomUUID(),
  title: 'TSMC Suspends Chip Production After Taiwan Rocked By Strongest Tremor In 25 Years',
  text: 'Taiwan Semiconductor Manufacturing Co evacuated some fabs after the quake. Output at most lines resumed within hours.',
  passages: [],
};
const filing: SeenSource = { _id: randomUUID(), title: 'NVIDIA 10-K', text: null, passages: [] };

const reportId = randomUUID();
const now = new Date('2026-09-29T10:00:00Z');

function check(claims: DraftClaim[], seen: SeenSource[] = [news, filing]) {
  const draft: ReportDraft = { claims, openQuestions: [] };
  return checkDraft(draft, {
    seen: new Map(seen.map((s) => [s._id, s])),
    reportId,
    newId: randomUUID,
    now,
  });
}

const fact = (overrides: Partial<DraftClaim> = {}): DraftClaim => ({
  key: 'c1',
  type: 'fact',
  text: 'TSMC evacuated some fabs after the earthquake.',
  sources: [{ sourceId: news._id, quote: 'evacuated some fabs after the quake' }],
  premises: [],
  ...overrides,
});

const TSMC_QUOTE =
  'We utilize foundries, such as Taiwan Semiconductor Manufacturing Company Limited, or TSMC, and Samsung Electronics Co., Ltd., or Samsung, to produce our semiconductor wafers.';

describe('quotes from a filing', () => {
  const filingFact = (quote: string): DraftClaim =>
    fact({ text: 'NVIDIA uses TSMC as a foundry.', sources: [{ sourceId: filing._id, quote }] });

  it('keeps a fact whose quote is in filing text a tool returned in this run', () => {
    // An evidence quote or a search_filings passage; whitespace is normalized as for news.
    const read: SeenSource = { ...filing, passages: [`Item 1A. Risk Factors\n${TSMC_QUOTE}`] };
    const { claims } = check(
      [filingFact('such as Taiwan Semiconductor  Manufacturing Company')],
      [news, read],
    );
    expect(claims[0]?.status).toBe('unverified');
  });

  it('removes a filing fact when no filing text came back in this run', () => {
    const { claims, removedBy } = check([filingFact('such as Taiwan Semiconductor Manufacturing')]);
    expect(claims[0]?.status).toBe('removed');
    expect(removedBy.quote_verbatim).toEqual([claims[0]?._id]);
  });

  it('never counts text returned for another source', () => {
    const other: SeenSource = { ...news, passages: [TSMC_QUOTE] };
    const { claims } = check(
      [filingFact('such as Taiwan Semiconductor Manufacturing')],
      [other, filing],
    );
    expect(claims[0]?.status).toBe('removed');
  });
});

describe('checkDraft', () => {
  it('keeps a fact whose quote is in its source as unverified, with passing checks', () => {
    const { claims } = check([fact()]);

    expect(claims).toHaveLength(1);
    const [claim] = claims;
    expect(Claim.parse(claim)).toEqual(claim);
    expect(claim).toMatchObject({
      type: 'fact',
      reportId,
      status: 'unverified',
      sources: [{ sourceId: news._id, quote: 'evacuated some fabs after the quake' }],
      premises: [],
      createdAt: now,
    });
    expect(claim?.checks).toEqual([
      { name: 'sources_exist', passed: true, detail: null },
      { name: 'quote_verbatim', passed: true, detail: null },
    ]);
  });

  it('finds a quote from the headline, and after whitespace and entity normalization', () => {
    const fromTitle = fact({
      sources: [{ sourceId: news._id, quote: 'Strongest Tremor In 25 Years' }],
    });
    const spaced = fact({
      key: 'c2',
      sources: [{ sourceId: news._id, quote: 'Output at   most\nlines&nbsp;resumed' }],
    });

    const { claims } = check([fromTitle, spaced]);

    expect(claims.map((c) => c.status)).toEqual(['unverified', 'unverified']);
  });

  it('removes a fact whose quote was changed, even slightly', () => {
    const altered = fact({
      sources: [{ sourceId: news._id, quote: 'evacuated all fabs after the quake' }],
    });
    const recased = fact({
      key: 'c2',
      sources: [{ sourceId: news._id, quote: 'Evacuated some fabs after the quake' }],
    });

    const { claims, removedBy } = check([altered, recased]);

    expect(claims.map((c) => c.status)).toEqual(['removed', 'removed']);
    expect(claims[0]?.checks).toContainEqual({
      name: 'quote_verbatim',
      passed: false,
      detail: `quote not found in source ${news._id}`,
    });
    expect(removedBy.quote_verbatim).toEqual(claims.map((c) => c._id));
  });

  it('removes a fact whose quote is too short to prove anything, even when it is found', () => {
    const { claims } = check([fact({ sources: [{ sourceId: news._id, quote: 'TSMC' }] })]);
    expect(claims[0]?.status).toBe('removed');
    expect(claims[0]?.checks).toContainEqual({
      name: 'quote_verbatim',
      passed: false,
      detail: 'quote shorter than 20 characters',
    });
  });

  it('removes a fact that cites a source no tool returned in this run', () => {
    const unseen = randomUUID();
    const { claims, removedBy } = check([
      fact({ sources: [{ sourceId: unseen, quote: 'evacuated some fabs after the quake' }] }),
    ]);

    expect(claims[0]?.status).toBe('removed');
    expect(claims[0]?.checks).toEqual([
      {
        name: 'sources_exist',
        passed: false,
        detail: `not returned by a tool in this run: ${unseen}`,
      },
      { name: 'quote_verbatim', passed: false, detail: `quote not found in source ${unseen}` },
    ]);
    expect(removedBy.sources_exist).toEqual([claims[0]?._id]);
  });

  it('removes a fact quoting a filing, whose text is not on the Source', () => {
    const { claims } = check([
      fact({ sources: [{ sourceId: filing._id, quote: 'We utilize foundries, such as TSMC' }] }),
    ]);
    expect(claims[0]?.status).toBe('removed');
  });

  it('drops a draft claim that cannot be a Claim, such as a fact without a quote', () => {
    const { claims, dropped } = check([
      fact({ sources: [{ sourceId: news._id }] }),
      fact({ key: 'c2', sources: [{ sourceId: 'not-an-id', quote: 'evacuated' }] }),
    ]);

    expect(claims).toEqual([]);
    expect(dropped.map((d) => d.key)).toEqual(['c1', 'c2']);
  });

  it('keeps a metric unverified when its source exists; numbers are checked in T14', () => {
    const metric = fact({
      type: 'metric',
      text: 'Output resumed within hours.',
      sources: [{ sourceId: news._id }],
    });

    const { claims } = check([metric]);

    expect(claims[0]).toMatchObject({
      type: 'metric',
      status: 'unverified',
      sources: [{ sourceId: news._id, quote: null }],
    });
    expect(claims[0]?.checks).toEqual([{ name: 'sources_exist', passed: true, detail: null }]);
  });

  it('keeps an inference whose premises are kept, and links them by claim id', () => {
    const inference: DraftClaim = {
      key: 'c2',
      type: 'inference',
      text: 'NVIDIA supply may be affected if the pause lasts.',
      sources: [],
      premises: ['c1'],
    };

    const { claims } = check([fact(), inference]);

    expect(claims[1]).toMatchObject({
      type: 'inference',
      status: 'unverified',
      premises: [claims[0]?._id],
      checks: [],
    });
  });

  it('removes an inference whose premise was removed, through a chain', () => {
    const bad = fact({ sources: [{ sourceId: news._id, quote: 'made up words' }] });
    const first: DraftClaim = {
      key: 'c2',
      type: 'inference',
      text: 'A first inference.',
      sources: [],
      premises: ['c1'],
    };
    const second: DraftClaim = { ...first, key: 'c3', text: 'A second one.', premises: ['c2'] };

    const { claims, removedBy } = check([bad, first, second]);

    expect(claims.map((c) => c.status)).toEqual(['removed', 'removed', 'removed']);
    expect(claims[2]?.checks).toEqual([
      { name: 'premises_supported', passed: false, detail: 'premise c2 was removed' },
    ]);
    expect(removedBy.premises_supported).toEqual([claims[1]?._id, claims[2]?._id]);
  });

  it('removes an inference that names a premise not in the draft', () => {
    const inference: DraftClaim = {
      key: 'c2',
      type: 'inference',
      text: 'Something follows.',
      sources: [],
      premises: ['c1', 'c9'],
    };

    const { claims } = check([fact(), inference]);

    expect(claims[1]).toMatchObject({ status: 'removed', premises: [claims[0]?._id] });
    expect(claims[1]?.checks).toEqual([
      { name: 'premises_supported', passed: false, detail: 'premise c9 is not in the report' },
    ]);
  });

  it('drops an inference whose only premise is not in the draft', () => {
    const inference: DraftClaim = {
      key: 'c1',
      type: 'inference',
      text: 'Something follows.',
      sources: [],
      premises: ['c9'],
    };
    const { claims, dropped } = check([inference]);
    expect(claims).toEqual([]);
    expect(dropped).toHaveLength(1);
  });
});
