import type { Claim } from '@kesher/shared';
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
    expect(JSON.stringify(result)).not.toContain(removed.text);
  });

  it('drops a supported claim whose cited source cannot be shown: no evidence, no claim', () => {
    const noFiling = DEMO_REPORT_SOURCES.filter(
      (source) => source._id !== foundry.sources[0]?.sourceId,
    );
    const result = view(DEMO_CLAIMS, noFiling);
    expect(result.rows.map((row) => row.claim._id)).not.toContain(foundry._id);
    expect(result.removedReasons).toContain('It cited a source that does not exist');
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
    expect(result.removedReasons).toContain('A claim it builds on was not supported');
    expect(result.rows.every((row) => !row.evidence.text.includes('Built on claims .'))).toBe(true);
    expect(result.counts).toEqual({ supported: 2, unverified: 0, removed: 3 });
  });

  it('keeps the bar in step with the claims it shows', () => {
    const result = view(DEMO_CLAIMS);
    expect(result.bar).toEqual(['supported', 'supported', 'supported', 'supported', 'removed']);
    expect(result.barLabel).toBe('4 claims supported, 1 removed');
  });
});
