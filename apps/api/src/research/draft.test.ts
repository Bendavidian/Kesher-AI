import { describe, expect, it } from 'vitest';
import { ReportDraft } from './draft';

const claim = {
  key: 'c1',
  type: 'fact',
  text: 'TSMC evacuated some fabs after the earthquake.',
  sources: [{ sourceId: '95bbf8fc-ae17-44c0-935d-6c73c640e9bf', quote: 'evacuated some fabs' }],
  premises: [],
  figures: [],
};

describe('ReportDraft', () => {
  it('keeps the report when a premise is not a claim key, such as a source id', () => {
    // A real run put source ids in the premises of its facts; the whole report was rejected and
    // its code claims were lost (T20). checkDraft ignores a fact's premises and removes an
    // inference whose premise is not in the report.
    const draft = ReportDraft.safeParse({
      claims: [
        { ...claim, premises: ['332c984b-1867-4c7f-b23a-5426142fdcbf'] },
        { ...claim, key: 'c2', type: 'inference', premises: ['c1', 'e1', 'm1'] },
      ],
      openQuestions: [],
    });
    expect(draft.success).toBe(true);
  });

  it('still rejects a claim key outside c1 to c99, so the model never takes a code key', () => {
    for (const key of ['e1', 'm1', 'c100', 'C1']) {
      expect(
        ReportDraft.safeParse({ claims: [{ ...claim, key }], openQuestions: [] }).success,
      ).toBe(false);
    }
  });

  it('bounds a premise to a short string', () => {
    const long = { ...claim, key: 'c2', type: 'inference', premises: ['x'.repeat(65)] };
    expect(ReportDraft.safeParse({ claims: [long], openQuestions: [] }).success).toBe(false);
  });
});
