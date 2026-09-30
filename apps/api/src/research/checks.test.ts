import { randomUUID } from 'node:crypto';
import {
  Claim,
  pathFactText,
  priceMetricFor,
  SHORT_NAME,
  type FeedEvidence,
  type FeedPath,
  type PriceReaction,
  type UniverseSymbol,
} from '@kesher/shared';
import { describe, expect, it } from 'vitest';
import { checkDraft, containsAdvice, percentMatches, type SeenSource } from './checks';
import type { DraftClaim, ReportDraft } from './draft';
import { codeClaimsFrom } from './core';
import { withPassages } from './toolSources';

const news: SeenSource = {
  _id: randomUUID(),
  title: 'TSMC Suspends Chip Production After Taiwan Rocked By Strongest Tremor In 25 Years',
  text: 'Taiwan Semiconductor Manufacturing Co evacuated some fabs after the quake. Output at most lines resumed within hours.',
};
const filing: SeenSource = { _id: randomUUID(), title: 'NVIDIA 10-K', text: null };

const reportId = randomUUID();
const now = new Date('2026-09-29T10:00:00Z');

const t = (iso: string) => new Date(iso);
const move = (pct: number | null, at: string) => ({ pct, barTime: pct === null ? null : t(at) });

// The demo event's moves (docs/SPIKE.md check 3), with NVDA's session close not ready yet.
const reaction: PriceReaction = {
  anchor: { kind: 'previous_close', baseTime: t('2024-04-02T20:00:00Z'), tradingDay: '2024-04-03' },
  windows: [
    { name: 'open_gap', endsAt: t('2024-04-03T13:30:00Z') },
    { name: '15m', endsAt: t('2024-04-03T13:45:00Z') },
    { name: '2h', endsAt: t('2024-04-03T15:30:00Z') },
    { name: 'session_close', endsAt: t('2024-04-03T20:00:00Z') },
  ],
  rows: [
    ['TSM', 140.21, [-1.16, -0.38, 1.31, 1.25]],
    ['NVDA', 894.47, [-1.07, -0.9, 0.1, null]],
    ['SMH', 219.6, [-1, -0.62, 0.64, 0.56]],
    ['SPY', 522.16, [-0.22, -0.1, 0.12, 0.11]],
  ].map(([symbol, basePrice, pcts]) => ({
    symbol: symbol as 'TSM',
    basePrice: basePrice as number,
    baseBarTime: t('2024-04-02T19:59:00Z'),
    moves: (pcts as (number | null)[]).map((pct) => move(pct, '2024-04-03T13:30:00Z')),
  })),
  delayed: true,
  complete: false,
};
const marketSourceId = randomUUID();

function check(
  claims: DraftClaim[],
  seen: SeenSource[] = [news, filing],
  {
    openQuestions = [],
    market = reaction,
  }: { openQuestions?: string[]; market?: PriceReaction | null } = {},
) {
  const draft: ReportDraft = { claims, openQuestions };
  return checkDraft(draft, {
    seen: new Map(seen.map((s) => [s._id, s])),
    reportId,
    newId: randomUUID,
    now,
    reaction: market,
    marketSourceId,
  });
}

const fact = (overrides: Partial<DraftClaim> = {}): DraftClaim => ({
  key: 'c1',
  type: 'fact',
  text: 'TSMC evacuated some fabs after the earthquake.',
  sources: [{ sourceId: news._id, quote: 'evacuated some fabs after the quake' }],
  premises: [],
  figures: [],
  ...overrides,
});

const TSMC_QUOTE =
  'We utilize foundries, such as Taiwan Semiconductor Manufacturing Company Limited, or TSMC, and Samsung Electronics Co., Ltd., or Samsung, to produce our semiconductor wafers.';

describe('quotes from a filing', () => {
  const filingFact = (quote: string): DraftClaim =>
    fact({ text: 'NVIDIA uses TSMC as a foundry.', sources: [{ sourceId: filing._id, quote }] });

  it('keeps a fact whose quote is in filing text a tool returned in this run', () => {
    // An evidence quote or a search_filings passage; whitespace is normalized as for news.
    const read = withPassages(filing, ['Item 1A. Risk Factors', TSMC_QUOTE]);
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

  it('never matches a quote across two returned passages', () => {
    const read = withPassages(filing, ['We utilize foundries, such as', 'Taiwan Semiconductor']);
    const { claims } = check([filingFact('such as Taiwan Semiconductor')], [news, read]);
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
      { name: 'no_advice', passed: true, detail: null },
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
      { name: 'no_advice', passed: true, detail: null },
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

  it('keeps a metric without figures unverified: only price moves are checked until XBRL', () => {
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
      figures: [],
    });
    expect(claims[0]?.checks).toEqual([
      { name: 'sources_exist', passed: true, detail: null },
      { name: 'no_advice', passed: true, detail: null },
    ]);
  });

  it('keeps an inference whose premises are kept, and links them by claim id', () => {
    const inference: DraftClaim = {
      key: 'c2',
      type: 'inference',
      text: 'NVIDIA supply may be affected if the pause lasts.',
      sources: [],
      premises: ['c1'],
      figures: [],
    };

    const { claims } = check([fact(), inference]);

    expect(claims[1]).toMatchObject({
      type: 'inference',
      status: 'unverified',
      premises: [claims[0]?._id],
      checks: [{ name: 'no_advice', passed: true, detail: null }],
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
      figures: [],
    };
    const second: DraftClaim = { ...first, key: 'c3', text: 'A second one.', premises: ['c2'] };

    const { claims, removedBy } = check([bad, first, second]);

    expect(claims.map((c) => c.status)).toEqual(['removed', 'removed', 'removed']);
    expect(claims[2]?.checks).toEqual([
      { name: 'no_advice', passed: true, detail: null },
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
      figures: [],
    };

    const { claims } = check([fact(), inference]);

    expect(claims[1]).toMatchObject({ status: 'removed', premises: [claims[0]?._id] });
    expect(claims[1]?.checks).toEqual([
      { name: 'no_advice', passed: true, detail: null },
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
      figures: [],
    };
    const { claims, dropped } = check([inference]);
    expect(claims).toEqual([]);
    expect(dropped).toHaveLength(1);
  });

  it('removes inferences whose premises form a cycle, and those built on them', () => {
    const inference = (key: string, premises: string[]): DraftClaim => ({
      key,
      type: 'inference',
      text: `Inference ${key} may follow.`,
      sources: [],
      premises,
      figures: [],
    });

    const { claims, removedBy } = check([
      fact(),
      inference('c2', ['c3']),
      inference('c3', ['c2']),
      inference('c4', ['c2']),
      inference('c5', ['c1']),
    ]);

    expect(claims.map((c) => c.status)).toEqual([
      'unverified',
      'removed',
      'removed',
      'removed',
      'unverified',
    ]);
    expect(claims[1]?.checks).toContainEqual({
      name: 'premises_supported',
      passed: false,
      detail: 'its premises never reach a fact or a metric: c3',
    });
    expect(removedBy.premises_supported).toEqual([claims[1]?._id, claims[2]?._id, claims[3]?._id]);
  });
});

const metric = (overrides: Partial<DraftClaim> = {}): DraftClaim => ({
  key: 'c1',
  type: 'metric',
  text: 'TSM opened −1.16% below its previous close; SMH −1.00%, SPY −0.22%.',
  sources: [],
  premises: [],
  figures: [
    { symbol: 'TSM', window: 'open_gap', pct: -1.16 },
    { symbol: 'SMH', window: 'open_gap', pct: -1 },
    { symbol: 'SPY', window: 'open_gap', pct: -0.22 },
  ],
  ...overrides,
});

describe('numbers_match', () => {
  it('keeps a metric whose figures equal the reaction, citing the market data source', () => {
    const { claims, removedBy } = check([metric()]);

    expect(claims[0]).toMatchObject({
      type: 'metric',
      status: 'unverified',
      sources: [{ sourceId: marketSourceId, quote: null }],
      figures: metric().figures,
    });
    expect(claims[0]?.checks).toContainEqual({ name: 'numbers_match', passed: true, detail: null });
    expect(removedBy.numbers_match).toEqual([]);
  });

  it('keeps the sources a metric cites next to the market data', () => {
    const { claims } = check([metric({ sources: [{ sourceId: news._id }] })]);
    expect(claims[0]?.sources).toEqual([
      { sourceId: news._id, quote: null },
      { sourceId: marketSourceId, quote: null },
    ]);
  });

  it('matches a percentage in the text to a figure rounded to the decimals the text shows', () => {
    const nvda = [{ symbol: 'NVDA' as const, window: 'open_gap' as const, pct: -1.07 }];

    const rounded = check([metric({ text: 'NVDA opened −1.1% below its close.', figures: nvda })]);
    const wrong = check([metric({ text: 'NVDA opened −1.2% below its close.', figures: nvda })]);

    expect(rounded.claims[0]?.status).toBe('unverified');
    expect(wrong.claims[0]?.status).toBe('removed');
    expect(wrong.claims[0]?.checks).toContainEqual({
      name: 'numbers_match',
      passed: false,
      detail: 'the text gives -1.2%, which is none of its figures',
    });
    expect(wrong.removedBy.numbers_match).toEqual([wrong.claims[0]?._id]);
  });

  it('removes a metric whose figure differs from the reaction, however slightly', () => {
    const { claims } = check([
      metric({
        text: 'TSM opened −1.61% below its previous close.',
        figures: [{ symbol: 'TSM', window: 'open_gap', pct: -1.61 }],
      }),
    ]);

    expect(claims[0]?.status).toBe('removed');
    expect(claims[0]?.checks).toContainEqual({
      name: 'numbers_match',
      passed: false,
      detail: 'TSM open_gap is -1.16%, not -1.61%',
    });
  });

  it('removes a metric that swaps a symbol or a window', () => {
    const swapped = check([
      metric({
        text: 'NVDA opened −1.16% lower.',
        figures: [{ symbol: 'NVDA', window: 'open_gap', pct: -1.16 }],
      }),
    ]);
    const window = check([
      metric({
        text: 'TSM was −1.16% two hours after the open.',
        figures: [{ symbol: 'TSM', window: '2h', pct: -1.16 }],
      }),
    ]);

    expect(swapped.claims[0]?.checks).toContainEqual({
      name: 'numbers_match',
      passed: false,
      detail: 'NVDA open_gap is -1.07%, not -1.16%',
    });
    expect(window.claims[0]?.status).toBe('removed');
  });

  it('removes a metric whose window is not ready, or whose symbol has no row', () => {
    const notReady = check([
      metric({
        text: 'NVDA closed +0.40%.',
        figures: [{ symbol: 'NVDA', window: 'session_close', pct: 0.4 }],
      }),
    ]);
    const noRow = check([
      metric({
        text: 'AMD opened −2.00%.',
        figures: [{ symbol: 'AMD', window: 'open_gap', pct: -2 }],
      }),
    ]);

    expect(notReady.claims[0]?.checks).toContainEqual({
      name: 'numbers_match',
      passed: false,
      detail: 'NVDA session_close is not available yet',
    });
    expect(noRow.claims[0]?.checks).toContainEqual({
      name: 'numbers_match',
      passed: false,
      detail: 'the reaction has no AMD row',
    });
  });

  it('removes a metric whose text gives a number that is none of its figures, or none at all', () => {
    const extra = check([metric({ text: 'TSM opened −1.16% while NVDA fell −3.00%.' })]);
    const none = check([metric({ text: 'TSM opened lower than its previous close.' })]);

    expect(extra.claims[0]?.checks).toContainEqual({
      name: 'numbers_match',
      passed: false,
      detail: 'the text gives -3.00%, which is none of its figures',
    });
    expect(none.claims[0]?.checks).toContainEqual({
      name: 'numbers_match',
      passed: false,
      detail: 'the text gives no percentage',
    });
  });

  it('leaves a metric unverified, unchecked, when the market data could not be read', () => {
    const { claims } = check([metric()], [news], { market: null });
    expect(claims[0]?.status).toBe('unverified');
    expect(claims[0]?.checks.map((c) => c.name)).not.toContain('numbers_match');
  });

  it('ignores figures on a claim that is not a metric', () => {
    const { claims } = check([fact({ figures: metric().figures })]);
    expect(claims[0]).not.toHaveProperty('figures');
  });
});

describe('percentMatches', () => {
  it('rounds the figure half away from zero to the decimals the text shows', () => {
    expect(percentMatches('−1.1', -1.07)).toBe(true);
    expect(percentMatches('-1.1', -1.05)).toBe(true);
    expect(percentMatches('−1.2', -1.07)).toBe(false);
    expect(percentMatches('−1', -1.07)).toBe(true);
    expect(percentMatches('−1.07', -1.07)).toBe(true);
    expect(percentMatches('−1.070', -1.07)).toBe(true);
    expect(percentMatches('−1.071', -1.07)).toBe(false);
    expect(percentMatches('+1.25', 1.25)).toBe(true);
    expect(percentMatches('0.00', 0)).toBe(true);
  });

  it('reads a number without a sign as positive', () => {
    expect(percentMatches('1.07', -1.07)).toBe(false);
    expect(percentMatches('1.31', 1.31)).toBe(true);
  });
});

describe('no_advice', () => {
  it('removes a claim with buy, sell or hold language', () => {
    const advice = fact({
      text: 'Investors may want to sell NVDA until the fabs restart.',
    });
    const rating = fact({ key: 'c2', text: 'TSMC now looks like a hold.' });

    const { claims, removedBy } = check([advice, rating]);

    expect(claims.map((c) => c.status)).toEqual(['removed', 'removed']);
    expect(claims[0]?.checks).toContainEqual({
      name: 'no_advice',
      passed: false,
      detail: 'buy, sell or hold language: "sell"',
    });
    expect(removedBy.no_advice).toEqual(claims.map((c) => c._id));
  });

  it('leaves words that only look like advice', () => {
    for (const text of [
      'NVDA holders saw the open gap.',
      'A chip sell-off followed the quake.',
      'TSMC holdings in Arizona were unaffected.',
      'Shareholders were told on Wednesday.',
    ]) {
      expect(containsAdvice(text), text).toBeNull();
    }
    expect(containsAdvice('Buy the dip.')).toBe('Buy');
    expect(containsAdvice('Analysts rate it overweight.')).toBe('overweight');
  });

  it('drops an open question with advice language and keeps the rest', () => {
    const { openQuestions, droppedQuestions } = check([fact()], [news], {
      openQuestions: ['How long did the pause last?', 'Should investors buy TSM now?'],
    });

    expect(openQuestions).toEqual(['How long did the pause last?']);
    expect(droppedQuestions).toEqual(['Should investors buy TSM now?']);
  });
});

// The deterministic report core (T20): code claims go through the same checks, first.
describe('code claims', () => {
  const pathItem: FeedPath = {
    eventCompany: 'TSM',
    holding: 'NVDA',
    hops: [
      {
        from: 'TSM',
        to: 'NVDA',
        type: 'supplier_of',
        weight: 0.8,
        relationshipId: randomUUID(),
      },
    ],
  };
  const evidence: FeedEvidence = {
    relationshipId: pathItem.hops[0]!.relationshipId,
    from: 'TSM',
    to: 'NVDA',
    type: 'supplier_of',
    quote: TSMC_QUOTE,
    filingDate: '2026-02-25',
    url: 'https://www.sec.gov/Archives/edgar/data/1045810/nvda-10k.htm',
    reviewed: true,
    filing: { sourceId: filing._id, symbol: 'NVDA', title: 'NVIDIA 10-K', form: '10-K', tier: 1 },
  };

  function checkWithCore(model: DraftClaim[]) {
    const core = codeClaimsFrom(pathItem, [evidence], reaction);
    const seen = new Map(
      [news, withPassages(filing, core.passages.get(filing._id))].map((s) => [s._id, s]),
    );
    return checkDraft(
      { claims: model, openQuestions: [] },
      { seen, reportId, newId: randomUUID, now, reaction, marketSourceId },
      core.claims,
    );
  }

  it('checks code claims first, and marks each claim with who wrote it', () => {
    const checked = checkWithCore([fact()]);

    expect(checked.claims.map((c) => [c.origin, c.type, c.status])).toEqual([
      ['code', 'fact', 'unverified'],
      ['code', 'metric', 'unverified'],
      ['model', 'fact', 'unverified'],
    ]);
    const [pathFact, metric] = checked.claims;
    expect(pathFact?.checks.map((c) => [c.name, c.passed])).toEqual([
      ['sources_exist', true],
      ['quote_verbatim', true],
      ['no_advice', true],
    ]);
    expect(metric?.checks.map((c) => [c.name, c.passed])).toEqual([
      ['numbers_match', true],
      ['no_advice', true],
    ]);
    expect(metric?.sources).toEqual([{ sourceId: marketSourceId, quote: null }]);
    expect([...checked.keys.values()]).toEqual(['e1', 'm1', 'c1']);
  });

  it('lets a model inference stand on code claims by key', () => {
    const checked = checkWithCore([
      {
        key: 'c1',
        type: 'inference',
        text: 'NVIDIA wafer supply may be exposed while TSMC recovers.',
        sources: [],
        premises: ['e1', 'm1'],
        figures: [],
      },
    ]);

    const [pathFact, metric, inference] = checked.claims;
    expect(inference).toMatchObject({ origin: 'model', status: 'unverified' });
    expect(inference?.premises).toEqual([pathFact?._id, metric?._id]);
  });
});

describe('code claim templates and no_advice', () => {
  it('never write buy, sell or hold language, for any edge type or company', () => {
    const symbols = Object.keys(SHORT_NAME) as UniverseSymbol[];
    for (const type of ['supplier_of', 'customer_of', 'competitor_of'] as const) {
      for (const from of symbols) {
        for (const to of symbols) {
          const text = pathFactText({
            from,
            to,
            type,
            filing: { sourceId: filing._id, symbol: to, title: 'A filing', form: '10-K', tier: 1 },
          });
          expect(containsAdvice(text), text).toBeNull();
        }
      }
    }
    const metric = priceMetricFor(reaction, ['TSM', 'NVDA']);
    expect(metric.ok && containsAdvice(metric.text)).toBeNull();
  });

  it('keeps the fact of a customer_of hop through every check', () => {
    const hop = {
      from: 'NVDA',
      to: 'TSM',
      type: 'customer_of',
      weight: 0.8,
      relationshipId: randomUUID(),
    } as const;
    const core = codeClaimsFrom(
      { eventCompany: 'NVDA', holding: 'TSM', hops: [hop] },
      [
        {
          relationshipId: hop.relationshipId,
          from: 'NVDA',
          to: 'TSM',
          type: 'customer_of',
          quote: TSMC_QUOTE,
          filingDate: '2026-02-25',
          url: 'https://www.sec.gov/Archives/edgar/data/1045810/nvda-10k.htm',
          reviewed: true,
          filing: {
            sourceId: filing._id,
            symbol: 'NVDA',
            title: 'NVIDIA 10-K',
            form: '10-K',
            tier: 1,
          },
        },
      ],
      reaction,
    );
    const seen = new Map([[filing._id, withPassages(filing, core.passages.get(filing._id))]]);
    const checked = checkDraft(
      { claims: [], openQuestions: [] },
      { seen, reportId, newId: randomUUID, now, reaction, marketSourceId },
      core.claims,
    );
    expect(checked.claims[0]).toMatchObject({
      origin: 'code',
      text: "NVIDIA is a customer of TSMC, according to NVIDIA's 10-K.",
      status: 'unverified',
    });
  });
});

describe('codeClaimsFrom', () => {
  const hop = {
    from: 'TSM',
    to: 'NVDA',
    type: 'supplier_of',
    weight: 0.8,
    relationshipId: randomUUID(),
  } as const;

  it('writes no fact for a direct holding, only the metric', () => {
    const core = codeClaimsFrom({ eventCompany: 'TSM', holding: 'TSM', hops: [] }, [], reaction);
    expect(core.claims.map((c) => c.key)).toEqual(['m1']);
    expect(core.claims[0]?.text).toBe(
      'TSM opened −1.16% below its previous close; SMH −1.00%, SPY −0.22%.',
    );
    expect(core.omitted).toEqual([]);
  });

  it('leaves out a hop without reviewed evidence, and a metric without market data', () => {
    const core = codeClaimsFrom({ eventCompany: 'TSM', holding: 'NVDA', hops: [hop] }, [], null);
    expect(core.claims).toEqual([]);
    expect(core.passages.size).toBe(0);
    expect(core.omitted).toEqual([
      { kind: 'path_fact', reason: 'no_evidence' },
      { kind: 'price_metric', reason: 'unavailable' },
    ]);
  });
});
