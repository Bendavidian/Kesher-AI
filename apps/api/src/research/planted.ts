import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { LlmProvider, type CheckName, type Claim, type PriceReaction } from '@kesher/shared';
import { z } from 'zod';
import { toIncomingItem } from '../ingest/alpaca';
import { loadRecording, RECORDINGS_DIR } from '../ingest/recordings';
import { loadReactionFixture } from '../market/fixture';
import type { ModelClient } from '../llm/client';
import { checkDraft, type SeenSource } from './checks';
import type { ReportDraft } from './draft';
import { RecordedVerifierCall } from './recordings';
import { applyVerdicts, VERIFIER_TOKEN_CAP, verifyClaims, type VerifierCall } from './verifier';

// A report with planted errors over the demo item (Alpaca news 38062166) and its committed price
// reaction: each error is aimed at one check, next to clean claims that must end supported. The
// done criterion of T14 is that every planted error is caught. npm run verify:dev runs the real
// verifier on it once and records the answers; the test replays them, and T16 grows the set.

export const DEMO_ID = '38062166';
const SOURCE_ID = '5f0c2a8e-1d3b-4c7a-9e21-6b8f4d2c9a01';
const UNSEEN_ID = '9a1e7c44-2b6d-4f08-8c3e-1d5a7b9e0f12';
export const PLANTED_MARKET_SOURCE_ID = 'c3d9e1f2-7a4b-4c5d-8e6f-0a1b2c3d4e5f';
export const PLANTED_REPORT_ID = '0e4f8a2b-6c1d-4e3f-9a7b-5c2d1e0f3a4b';

// What each claim must end as: supported, or removed by that check. question is an open question
// the no_advice check must drop.
export type Expected = 'supported' | CheckName;

const HEADLINE =
  'TSMC Suspends Chip Production After Taiwan Rocked By Strongest Tremor In 25 Years';
const QUAKE = 'Taiwan was struck by a powerful 7.2 magnitude earthquake on Wednesday';
const TOLL = 'The quake has resulted in one fatality, numerous injuries';

const fact = (key: string, text: string, quote: string, sourceId = SOURCE_ID) => ({
  key,
  type: 'fact' as const,
  text,
  sources: [{ sourceId, quote }],
  premises: [],
  figures: [],
});
const metric = (key: string, text: string, figures: ReportDraft['claims'][number]['figures']) => ({
  key,
  type: 'metric' as const,
  text,
  sources: [],
  premises: [],
  figures,
});
const inference = (key: string, text: string, premises: string[]) => ({
  key,
  type: 'inference' as const,
  text,
  sources: [],
  premises,
  figures: [],
});

export const PLANTED_CLAIMS: {
  claim: ReportDraft['claims'][number];
  expected: Expected;
  why: string;
}[] = [
  // Clean claims.
  {
    claim: fact(
      'c1',
      'TSMC suspended chip production after the strongest tremor in Taiwan in 25 years.',
      HEADLINE,
    ),
    expected: 'supported',
    why: 'clean fact from the headline',
  },
  {
    claim: fact('c2', 'A 7.2 magnitude earthquake struck Taiwan on Wednesday.', QUAKE),
    expected: 'supported',
    why: 'clean fact from the summary',
  },
  {
    claim: metric(
      'c3',
      'NVDA opened −1.07% below its previous close, next to SMH at −1.00% and SPY at −0.22% in the same window.',
      [
        { symbol: 'NVDA', window: 'open_gap', pct: -1.07 },
        { symbol: 'SMH', window: 'open_gap', pct: -1 },
        { symbol: 'SPY', window: 'open_gap', pct: -0.22 },
      ],
    ),
    expected: 'supported',
    why: 'clean metric, timing next to the benchmarks',
  },
  {
    claim: inference(
      'c4',
      'If the pause lasts, it could tighten chip supply for TSMC customers such as NVIDIA.',
      ['c1'],
    ),
    expected: 'supported',
    why: 'clean hedged inference',
  },
  // Planted for the deterministic checks.
  {
    claim: fact(
      'c5',
      'A 7.4 magnitude earthquake struck Taiwan on Wednesday.',
      'Taiwan was struck by a powerful 7.4 magnitude earthquake on Wednesday',
    ),
    expected: 'quote_verbatim',
    why: 'altered quote',
  },
  {
    claim: fact('c6', 'The quake measured 7.2.', '7.2 magnitude'),
    expected: 'quote_verbatim',
    why: 'quote too short to prove anything',
  },
  {
    claim: fact(
      'c7',
      'TSMC said most of its tools recovered within hours.',
      'most tools recovered within hours',
      UNSEEN_ID,
    ),
    expected: 'sources_exist',
    why: 'cites a source no tool returned',
  },
  {
    claim: metric('c8', 'TSM opened −1.61% below its previous close.', [
      { symbol: 'TSM', window: 'open_gap', pct: -1.61 },
    ]),
    expected: 'numbers_match',
    why: 'transposed digits in the figure',
  },
  {
    claim: metric('c9', 'NVDA opened −1.2% below its previous close.', [
      { symbol: 'NVDA', window: 'open_gap', pct: -1.07 },
    ]),
    expected: 'numbers_match',
    why: 'text rounds the figure wrong',
  },
  {
    claim: metric('c10', 'TSM was −1.16% two hours after the open.', [
      { symbol: 'TSM', window: '2h', pct: -1.16 },
    ]),
    expected: 'numbers_match',
    why: 'the open gap move given for another window',
  },
  {
    claim: fact('c11', 'Investors should sell NVDA until TSMC restarts production.', HEADLINE),
    expected: 'no_advice',
    why: 'sell advice with a valid quote',
  },
  {
    claim: inference('c12', 'The stronger quake may keep fabs closed for longer.', ['c5']),
    expected: 'premises_supported',
    why: 'built on a removed claim',
  },
  {
    claim: inference('c13', 'Supply may tighten because prices may rise.', ['c14']),
    expected: 'premises_supported',
    why: 'premise cycle',
  },
  {
    claim: inference('c14', 'Prices may rise because supply may tighten.', ['c13']),
    expected: 'premises_supported',
    why: 'premise cycle',
  },
  // Planted for the verifier: every deterministic check passes.
  {
    claim: fact('c15', 'The earthquake killed dozens of people in Taiwan.', TOLL),
    expected: 'verifier',
    why: 'misstates a verbatim quote (one fatality)',
  },
  {
    claim: fact('c16', 'The earthquake caused NVIDIA shares to fall at the open.', HEADLINE),
    expected: 'verifier',
    why: 'a cause no source states',
  },
  {
    claim: metric('c17', 'NVDA fell −1.07% at the open because TSMC halted production.', [
      { symbol: 'NVDA', window: 'open_gap', pct: -1.07 },
    ]),
    expected: 'verifier',
    why: 'correct numbers stated as caused by the headline',
  },
  {
    claim: inference(
      'c18',
      'NVIDIA will miss its next quarterly revenue target because of the shutdown.',
      ['c1'],
    ),
    expected: 'verifier',
    why: 'unhedged inference that adds a cause',
  },
  {
    claim: fact('c19', 'TSMC suspended production at all of its fabs for a full week.', HEADLINE),
    expected: 'verifier',
    why: 'adds a detail the source does not give',
  },
];

export const PLANTED_QUESTIONS = {
  kept: 'How long did the production pause last?',
  dropped: 'Should NVDA holders sell before the next earnings report?',
};

export const PLANTED_DRAFT: ReportDraft = {
  claims: PLANTED_CLAIMS.map((p) => p.claim),
  openQuestions: [PLANTED_QUESTIONS.kept, PLANTED_QUESTIONS.dropped],
};

export interface PlantedFixture {
  source: SeenSource;
  reaction: PriceReaction;
}

// The demo item as the pipeline stores it, and its committed price reaction.
export async function loadPlantedFixture(): Promise<PlantedFixture> {
  const recording = await loadRecording(DEMO_ID);
  if (!recording) throw new Error(`recordings/alpaca/${DEMO_ID}.json is missing`);
  const item = toIncomingItem(recording.item);
  const { reaction } = await loadReactionFixture(DEMO_ID);
  return { source: { _id: SOURCE_ID, title: item.title, text: item.text }, reaction };
}

// The real verifier's answers on the fixture, written by npm run verify:dev -- --record.
export const VerifierRecording = z.strictObject({
  fixture: z.literal('planted'),
  recordedAt: z.iso.datetime(),
  provider: LlmProvider,
  model: z.string().min(1),
  calls: z.array(RecordedVerifierCall).min(1),
});
export type VerifierRecording = z.infer<typeof VerifierRecording>;

export const verifierRecordingPath = (dir = RECORDINGS_DIR) =>
  join(dir, 'verifier', 'planted.json');

export async function loadVerifierRecording(
  dir = RECORDINGS_DIR,
): Promise<VerifierRecording | null> {
  const path = verifierRecordingPath(dir);
  if (!existsSync(path)) return null;
  return VerifierRecording.parse(JSON.parse(await readFile(path, 'utf8')));
}

export interface PlantedOutcome {
  // Each draft key with its final claim; a key that could not form a claim is missing.
  byKey: Map<string, Claim>;
  openQuestions: string[];
  droppedQuestions: string[];
}

// The same path as a research run: the deterministic checks, then the verifier, then code applies
// its verdicts.
export async function verifyPlanted(
  models: ModelClient,
  { source, reaction }: PlantedFixture,
  onCall?: (call: VerifierCall) => void,
): Promise<PlantedOutcome> {
  let n = 0;
  const ids = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
  const sources = new Map([[source._id, source]]);
  const checked = checkDraft(PLANTED_DRAFT, {
    seen: sources,
    reportId: PLANTED_REPORT_ID,
    newId: ids,
    now: new Date('2026-09-29T12:00:00Z'),
    reaction,
    marketSourceId: PLANTED_MARKET_SOURCE_ID,
  });
  const verified = await verifyClaims(
    models,
    { claims: checked.claims, sources, reaction, tokenCap: VERIFIER_TOKEN_CAP },
    { now: () => 0, ...(onCall ? { onCall } : {}) },
  );
  const { claims } = applyVerdicts(checked.claims, checked.keys, verified.verdicts);
  return {
    byKey: new Map(claims.map((c) => [checked.keys.get(c._id) ?? '', c])),
    openQuestions: checked.openQuestions,
    droppedQuestions: checked.droppedQuestions,
  };
}

// The check that removed a claim: its first failed one. null while it is not removed.
export const removedBy = (claim: Claim): CheckName | null =>
  claim.status === 'removed' ? (claim.checks.find((c) => !c.passed)?.name ?? null) : null;
