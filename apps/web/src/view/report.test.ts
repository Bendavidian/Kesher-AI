import type { Claim, Report } from '@kesher/shared';
import { describe, expect, it } from 'vitest';
import { DEMO_CLAIMS, DEMO_REPORT, DEMO_REPORT_SOURCES, DEMO_RUN } from '../fixtures/research';
import { buildReportView } from './report';

const [paused, foundry, supply, openGap, removed] = DEMO_CLAIMS as [
  Claim,
  Claim,
  Claim,
  Claim,
  Claim,
];

function view(claims: Claim[], sources = DEMO_REPORT_SOURCES) {
  return buildReportView(DEMO_REPORT, claims, DEMO_RUN, sources);
}

describe('buildReportView', () => {
  it('numbers the shown claims and keeps the removed one out of the rows', () => {
    const result = view(DEMO_CLAIMS);
    expect(result.rows.map((row) => row.claim._id)).toEqual([
      paused._id,
      foundry._id,
      supply._id,
      openGap._id,
    ]);
    expect(result.removedReasons).toEqual(["Its quote wasn't found in the cited source"]);
    expect(result.hiddenNotes).toEqual([]);
    expect(JSON.stringify(result)).not.toContain(removed.text);
  });

  it('adds one neutral line for each claim code left out, after the hidden claims', () => {
    const omitted: Report['omitted'] = [
      { kind: 'path_fact', reason: 'no_evidence' },
      { kind: 'price_metric', reason: 'not_ready' },
    ];
    const unverified = DEMO_CLAIMS.map((claim) =>
      claim._id === paused._id ? { ...claim, status: 'unverified' as const } : claim,
    );
    const result = buildReportView(
      { ...DEMO_REPORT, omitted },
      unverified,
      DEMO_RUN,
      DEMO_REPORT_SOURCES,
    );
    expect(result.hiddenNotes).toEqual([
      '1 claim was not verified, so it is not shown',
      "The filing quote for a link on your path couldn't be read, so it is not shown",
      "The price reaction wasn't available yet, so no price metric is shown",
    ]);
    // Left out is not removed: no red segment and no removed count.
    expect(result.counts.removed).toBe(1);
  });

  it('says so when the market data could not be read', () => {
    const result = buildReportView(
      { ...DEMO_REPORT, omitted: [{ kind: 'price_metric', reason: 'unavailable' }] },
      DEMO_CLAIMS,
      DEMO_RUN,
      DEMO_REPORT_SOURCES,
    );
    expect(result.hiddenNotes).toEqual([
      "The market data couldn't be read, so no price metric is shown",
    ]);
  });

  it('hides a claim whose cited source cannot be shown, without calling it removed', () => {
    const noFiling = DEMO_REPORT_SOURCES.filter(
      (source) => source._id !== foundry.sources[0]?.sourceId,
    );
    const result = view(DEMO_CLAIMS, noFiling);
    expect(result.rows.map((row) => row.claim._id)).not.toContain(foundry._id);
    expect(result.removedReasons).toEqual(["Its quote wasn't found in the cited source"]);
    expect(result.hiddenNotes).toEqual([
      '1 inference is hidden because a claim it builds on is not shown',
      "1 claim is hidden because its source can't be listed",
    ]);
    expect(result.bar.filter((status) => status === 'removed')).toHaveLength(
      result.removedReasons.length,
    );
  });

  it('shows an inference only when every premise is supported', () => {
    const premiseRemoved = DEMO_CLAIMS.map((claim) =>
      claim._id === foundry._id ? { ...claim, status: 'removed' as const } : claim,
    );
    const result = view(premiseRemoved);
    expect(result.rows.map((row) => row.claim._id)).not.toContain(supply._id);
    expect(result.removedReasons).toHaveLength(2);
    expect(result.hiddenNotes).toEqual([
      '1 inference is hidden because a claim it builds on is not shown',
    ]);
    expect(result.rows.every((row) => !row.evidence.text.includes('Built on claims .'))).toBe(true);
    expect(result.counts).toEqual({ supported: 2, unverified: 1, removed: 2 });
  });

  it('shows only supported claims, and hides unverified ones as not verified, never as removed', () => {
    // As when the verifier call failed: the checks kept every claim, the verifier judged none.
    const unverified = DEMO_CLAIMS.filter((claim) => claim.status !== 'removed').map((claim) => ({
      ...claim,
      status: 'unverified' as const,
    }));
    const result = view(unverified);
    expect(result.rows).toEqual([]);
    expect(result.removedReasons).toEqual([]);
    expect(result.hiddenNotes).toEqual(['4 claims were not verified, so they are not shown']);
    expect(result.counts).toEqual({ supported: 0, unverified: 4, removed: 0 });
    expect(result.bar).not.toContain('removed');
    expect(result.barLabel).toBe('0 claims supported, 4 not verified, 0 removed');
  });

  it('never shows an unverified inference, even on supported premises', () => {
    const claims = DEMO_CLAIMS.map((claim) =>
      claim._id === supply._id ? { ...claim, status: 'unverified' as const } : claim,
    );
    const result = view(claims);
    expect(result.rows.map((row) => row.claim._id)).not.toContain(supply._id);
    expect(result.hiddenNotes).toEqual(['1 claim was not verified, so it is not shown']);
  });

  it('marks every row supported, by type', () => {
    expect(view(DEMO_CLAIMS).rows.map((row) => row.status)).toEqual([
      'Supported',
      'Supported',
      'Premises supported',
      'Matches data',
    ]);
  });

  it('names the check behind each removal, advice and the verifier included', () => {
    const removedBy = (name: Claim['checks'][number]['name']): Claim => ({
      ...paused,
      _id: `${paused._id.slice(0, -1)}${name.length % 10}`,
      status: 'removed',
      checks: [{ name, passed: false, detail: 'failed' }],
    });
    const claims = [removedBy('no_advice'), removedBy('verifier')];
    const result = buildReportView(
      { ...DEMO_REPORT, sections: [{ title: 'Claims', claimIds: claims.map((c) => c._id) }] },
      claims,
      DEMO_RUN,
      DEMO_REPORT_SOURCES,
    );
    expect(result.removedReasons).toEqual([
      'It read as buy, sell or hold advice, which Kesher never gives',
      "The verifier found that its sources don't support it",
    ]);
    expect(result.removedClaimIds).toEqual(claims.map((c) => c._id));
  });

  it('anchors the market data of a metric as the design words it', () => {
    const result = buildReportView(
      DEMO_REPORT,
      DEMO_CLAIMS,
      DEMO_RUN,
      DEMO_REPORT_SOURCES,
      // The api's anchor for the demo headline (docs/SPIKE.md check 3).
      {
        kind: 'previous_close',
        baseTime: new Date('2024-04-02T20:00:00Z'),
        tradingDay: '2024-04-03',
      },
    );
    const metric = result.rows.find((row) => row.claim._id === openGap._id);
    expect(metric?.evidence.text).toBe(
      "SIP bars, anchored to the regular close on Apr 2 because the headline came outside the regular session. Timing only, the report doesn't claim a cause.",
    );
  });

  it('keeps the bar in step with the claims it shows', () => {
    const result = view(DEMO_CLAIMS);
    expect(result.bar).toEqual(['supported', 'supported', 'supported', 'supported', 'removed']);
    expect(result.barLabel).toBe('4 claims supported, 1 removed');
  });
});
