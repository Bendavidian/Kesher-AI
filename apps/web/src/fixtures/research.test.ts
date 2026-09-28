import { AgentRun, Claim, Report } from '@kesher/shared';
import { describe, expect, it } from 'vitest';
import { formatPercent } from '../view/format';
import { DEMO_EVENT, DEMO_PRICE_REACTION, RELATIONSHIPS } from './demoEvent';
import {
  DEMO_CLAIMS,
  DEMO_REPORT,
  DEMO_REPORT_SOURCES,
  DEMO_RUN,
  DEMO_STEP_OUTPUTS,
  DEMO_TOKEN_SCOPE,
} from './research';

describe('research fixtures', () => {
  it('pass the shared schemas unchanged', () => {
    expect(AgentRun.parse(DEMO_RUN)).toEqual(DEMO_RUN);
    expect(Report.parse(DEMO_REPORT)).toEqual(DEMO_REPORT);
    for (const claim of DEMO_CLAIMS) expect(Claim.parse(claim)).toEqual(claim);
  });

  it('hold the eleven design steps, with provider, model and tokens on every model step', () => {
    expect(DEMO_RUN.steps).toHaveLength(11);
    const models = DEMO_RUN.steps.flatMap((step) => (step.kind === 'model' ? [step] : []));
    expect(models.map((step) => `${step.provider}:${step.model}`)).toEqual([
      'google:gemini-3.5-flash-lite',
      'groq:openai/gpt-oss-120b',
    ]);
    const total = models.reduce((sum, step) => sum + step.tokens.total, 0);
    expect(DEMO_RUN.tokensUsed).toBe(total);
    for (const step of models) {
      expect(step.tokens.input + step.tokens.output).toBe(step.tokens.total);
    }
    expect(DEMO_RUN.tokenBudget).toBe(6_000);
    expect(DEMO_RUN.costUsd).toBe(0);
  });

  it('call only tools the run token allows', () => {
    const called = DEMO_RUN.steps.filter((step) => step.kind === 'tool').map((step) => step.name);
    expect(called.every((name) => DEMO_TOKEN_SCOPE.tools.includes(name))).toBe(true);
    expect(DEMO_TOKEN_SCOPE.writes).toEqual([]);
    expect(DEMO_RUN.agent).toBe(DEMO_TOKEN_SCOPE.agent);
  });

  it('key step outputs by existing steps', () => {
    for (const index of Object.keys(DEMO_STEP_OUTPUTS).map(Number)) {
      expect(DEMO_RUN.steps[index]).toBeDefined();
    }
  });

  it('have two facts, one inference and one metric, plus one removed claim', () => {
    const shown = DEMO_CLAIMS.filter((claim) => claim.status !== 'removed');
    expect(shown.map((claim) => claim.type)).toEqual(['fact', 'fact', 'inference', 'metric']);
    expect(DEMO_CLAIMS.filter((claim) => claim.status === 'removed')).toHaveLength(1);
    const reportClaims = DEMO_REPORT.sections.flatMap((section) => section.claimIds);
    expect(reportClaims).toEqual(DEMO_CLAIMS.map((claim) => claim._id));
  });

  it('quote the demo headline and the NVIDIA 10-K verbatim', () => {
    const quotes = DEMO_CLAIMS.filter((claim) => claim.status === 'supported').flatMap((claim) =>
      claim.sources.map((source) => source.quote),
    );
    expect(quotes).toContain(DEMO_EVENT.headline);
    expect(quotes).toContain(RELATIONSHIPS[0]?.evidence.quote);
  });

  it('state the anchored open gap moves from docs/SPIKE.md in the metric claim', () => {
    const metric = DEMO_CLAIMS.find((claim) => claim.type === 'metric');
    const gap = (symbol: string) =>
      DEMO_PRICE_REACTION.rows.find((row) => row.symbol === symbol)?.moves[0] ?? NaN;
    for (const symbol of ['NVDA', 'SMH', 'SPY']) {
      expect(metric?.text).toContain(formatPercent(gap(symbol)));
    }
  });

  it('list a source for every citation', () => {
    const ids = new Set(DEMO_REPORT_SOURCES.map((source) => source._id));
    for (const claim of DEMO_CLAIMS) {
      for (const source of claim.sources) expect(ids.has(source.sourceId)).toBe(true);
    }
  });
});
