import { RELEVANCE_HIGH, relevanceBand, type PersonaKey } from '@kesher/shared';
import { groupRelationships, type Review } from '../graph/review';
import type { CandidatesFile } from '../graph/rows';
import { eventCompanies } from '../relevance/score';
import { GATE_MIN_IMPORTANCE, GATE_MIN_RELEVANCE } from '../research/gate';
import type { Label, Level } from './labels';
import { PERSONA_KEYS } from './labels';
import {
  confusion,
  injectionOutcome,
  screenCounts,
  screenGroup,
  summarize,
  type Confusion,
  type InjectionOutcome,
  type ScreenCounts,
  type Summary,
} from './metrics';
import { PATH_KINDS, type EvalRun, type ItemRun, type PathKind } from './runner';

// The numbers of one eval run. Code decides every number here; docs/EVALS.md only shows them.

// Display band sets measured against the reviewed labels. The first is the T05 placeholder;
// medium from 0.4 is the mapping the proposed labels were written with
// (docs/research/eval-candidates.md); high at 1 keeps high for a holding itself. The set marked
// decided is relevanceBand since T16 (SPEC.md decision log). A set with highWith also calls a
// score high from that score when the extracted importance reaches the given class, the way the
// research gate reads importance. 0.8 is the supply hop weight.
export interface BandSet {
  name: string;
  highFrom: number;
  // Scores at or above this, and above 0, are medium.
  mediumFrom: number;
  highWith?: { relevanceFrom: number; importanceFrom: number };
  // The set relevanceBand implements (T16).
  decided?: boolean;
}

export const BAND_SETS: readonly BandSet[] = [
  { name: 'T05 placeholder: high from 0.8, medium above 0', highFrom: 0.8, mediumFrom: 0 },
  { name: 'high from 0.8, medium from 0.4', highFrom: 0.8, mediumFrom: 0.4 },
  {
    name: 'decided (T16): high only for a holding, medium above 0',
    highFrom: RELEVANCE_HIGH,
    mediumFrom: 0,
    decided: true,
  },
  { name: '1a: high only for a holding, medium from 0.4', highFrom: 1, mediumFrom: 0.4 },
  {
    name: `1b: high for a holding or from 0.8 with importance ${GATE_MIN_IMPORTANCE} or more, medium from 0.4`,
    highFrom: 1,
    mediumFrom: 0.4,
    highWith: { relevanceFrom: 0.8, importanceFrom: GATE_MIN_IMPORTANCE },
  },
];

// importance is the extraction's class, null when there is none.
export function bandWith(set: BandSet, relevance: number, importance: number | null): Level {
  if (relevance <= 0) return 'none';
  if (relevance >= set.highFrom) return 'high';
  const { highWith } = set;
  if (
    highWith &&
    importance !== null &&
    relevance >= highWith.relevanceFrom &&
    importance >= highWith.importanceFrom
  ) {
    return 'high';
  }
  return relevance >= set.mediumFrom ? 'medium' : 'none';
}

export interface LabelRow {
  sourceId: string;
  headline: string;
  persona: PersonaKey;
  label: Level;
  relevance: number;
  band: Level;
  path: string | null;
}

export interface PersonaAgreement {
  reviewed: Confusion;
  proposed: Confusion;
}

export interface InjectionRow {
  id: string;
  kind: string;
  baselineId: string;
  headline: string;
  screen: ReturnType<typeof screenGroup>;
  score: number | null;
  // null when the baseline's own extraction failed: nothing to compare, and the row stays out of
  // the success rates.
  outcome: InjectionOutcome | null;
  // Personas whose relevance would move under the tagged only rule.
  taggedOnlyMoved: PersonaKey[];
}

// The start node comparison: today's rule (extracted and tagged) against tagged only.
export interface StartNodeRules {
  current: Record<PersonaKey, Confusion>;
  taggedOnly: Record<PersonaKey, Confusion>;
  // Every pair of real item and persona where the two rules give different relevance.
  differences: {
    sourceId: string;
    headline: string;
    persona: PersonaKey;
    label: Level | null;
    current: number;
    taggedOnly: number;
  }[];
}

export interface EvalSummary {
  startedAt: Date;
  relationships: number;
  realItems: number;
  poisonedItems: number;
  labels: { reviewed: number; proposed: number };
  agreement: Record<PersonaKey, PersonaAgreement>;
  disagreements: LabelRow[];
  // Agreement of the reviewed labels under each candidate band set.
  bandSets: { set: BandSet; byPersona: Record<PersonaKey, Confusion>; total: Confusion }[];
  // Reviewed labels by how the path reaches the holding, all personas together.
  byPathKind: { kind: PathKind; pairs: number; labels: Record<Level, number> }[];
  startNodes: StartNodeRules;
  // Universe companies the extraction named that the provider did not tag (T05, fails closed).
  untagged: { sourceId: string; headline: string; symbols: string[] }[];
  // Real items whose extraction failed: no card, so relevance 0 and importance 0 above.
  failed: { sourceId: string; headline: string; error: string }[];
  gate: { passed: Record<PersonaKey, number>; pairs: number };
  injection: InjectionRow[];
  screen: { poisoned: ScreenCounts; clean: ScreenCounts; cleanMaxScore: number | null };
  cost: {
    totalTokens: Summary;
    inputTokens: Summary;
    outputTokens: Summary;
    screenCalls: Summary;
    screenMs: Summary;
    extractionMs: Summary;
    codeMs: Summary;
    fallbacks: number;
  };
  edges: EdgeExtractor;
}

export interface EdgeExtractor {
  relationships: number;
  accepted: number;
  model: { proposed: number; accepted: number };
  research: { proposed: number; accepted: number };
  acceptedNotByModel: string[];
}

const key = (sourceId: string, persona: PersonaKey) => `${sourceId}/${persona}`;

export function edgeExtractor(file: CandidatesFile, reviews: readonly Review[]): EdgeExtractor {
  const decisions = new Map(reviews.map((r) => [r.key, r.decision]));
  const groups = groupRelationships(file);
  const by = (group: (typeof groups)[number], who: 'model' | 'research') =>
    group.evidence.some(({ row }) =>
      row.proposals.some((p) => p.key === group.key && p.by.includes(who)),
    );
  const accepted = groups.filter((g) => decisions.get(g.key) === 'accept');
  const count = (who: 'model' | 'research') => {
    const proposed = groups.filter((g) => by(g, who));
    return {
      proposed: proposed.length,
      accepted: proposed.filter((g) => decisions.get(g.key) === 'accept').length,
    };
  };
  return {
    relationships: groups.length,
    accepted: accepted.length,
    model: count('model'),
    research: count('research'),
    acceptedNotByModel: accepted.filter((g) => !by(g, 'model')).map((g) => g.key),
  };
}

export function summarizeRun(
  run: EvalRun,
  labels: readonly Label[],
  edges: EdgeExtractor,
): EvalSummary {
  const real = run.items.filter((r) => r.item.kind === 'real');
  const poisoned = run.items.filter((r) => r.item.kind === 'poisoned');
  const byId = new Map(run.items.map((r) => [r.item.id, r]));
  const labelOf = new Map(labels.map((l) => [key(l.sourceId, l.persona), l]));

  const agreement = {} as Record<PersonaKey, PersonaAgreement>;
  const disagreements: LabelRow[] = [];
  for (const persona of PERSONA_KEYS) {
    const reviewed: { label: Level; predicted: Level }[] = [];
    const proposed: { label: Level; predicted: Level }[] = [];
    for (const r of real) {
      const label = labelOf.get(key(r.item.id, persona));
      if (!label) continue;
      const relevance = r.relevance[persona];
      const band = relevanceBand(relevance);
      if (label.status === 'proposed') {
        proposed.push({ label: label.level, predicted: band });
        continue;
      }
      reviewed.push({ label: label.level, predicted: band });
      if (label.level !== band) {
        disagreements.push({
          sourceId: r.item.id,
          headline: r.item.item.headline,
          persona,
          label: label.level,
          relevance,
          band,
          path: r.paths[persona],
        });
      }
    }
    agreement[persona] = {
      reviewed: confusion(reviewed),
      proposed: confusion(proposed),
    };
  }

  const current = {} as Record<PersonaKey, Confusion>;
  const taggedOnly = {} as Record<PersonaKey, Confusion>;
  const differences: StartNodeRules['differences'] = [];
  for (const persona of PERSONA_KEYS) {
    const now: { label: Level; predicted: Level }[] = [];
    const alt: { label: Level; predicted: Level }[] = [];
    for (const r of real) {
      const label = labelOf.get(key(r.item.id, persona));
      const reviewed = label?.status === 'reviewed' ? label.level : null;
      if (reviewed) {
        now.push({ label: reviewed, predicted: relevanceBand(r.relevance[persona]) });
        alt.push({ label: reviewed, predicted: relevanceBand(r.taggedOnly[persona]) });
      }
      if (r.relevance[persona] !== r.taggedOnly[persona]) {
        differences.push({
          sourceId: r.item.id,
          headline: r.item.item.headline,
          persona,
          label: reviewed,
          current: r.relevance[persona],
          taggedOnly: r.taggedOnly[persona],
        });
      }
    }
    current[persona] = confusion(now);
    taggedOnly[persona] = confusion(alt);
  }

  const untagged = real.flatMap((r) => {
    const named = (r.extraction?.companies ?? []).map((c) => c.symbol);
    const starts = new Set<string>(eventCompanies(named, r.tagged));
    const universe = new Set<string>(eventCompanies(named, named));
    const symbols = [...universe].filter((s) => !starts.has(s));
    return symbols.length === 0
      ? []
      : [{ sourceId: r.item.id, headline: r.item.item.headline, symbols }];
  });

  const passed = Object.fromEntries(PERSONA_KEYS.map((p) => [p, 0])) as Record<PersonaKey, number>;
  for (const r of real) {
    const importance = r.extraction?.importance ?? 0;
    for (const persona of PERSONA_KEYS) {
      if (r.relevance[persona] >= GATE_MIN_RELEVANCE && importance >= GATE_MIN_IMPORTANCE) {
        passed[persona] += 1;
      }
    }
  }

  const view = (r: ItemRun) =>
    r.extraction && {
      symbols: r.extraction.companies.map((c) => c.symbol),
      importance: r.extraction.importance,
    };
  const injection = poisoned.map((r): InjectionRow => {
    if (r.item.kind !== 'poisoned') throw new Error('not a poisoned item');
    const baseline = byId.get(r.item.poison.baselineId);
    if (!baseline) throw new Error(`no baseline run for ${r.item.id}`);
    const baselineView = view(baseline);
    const screen = screenGroup(r.screen);
    return {
      id: r.item.id,
      kind: r.item.poison.kind,
      baselineId: r.item.poison.baselineId,
      headline: r.item.item.headline,
      screen,
      taggedOnlyMoved: PERSONA_KEYS.filter((p) => baseline.taggedOnly[p] !== r.taggedOnly[p]),
      score: r.screen?.score ?? null,
      outcome:
        baselineView &&
        injectionOutcome({
          baseline: baselineView,
          poisoned: view(r),
          baselineRelevance: baseline.relevance,
          poisonedRelevance: r.relevance,
          screen,
        }),
    };
  });

  const cleanScores = real
    .map((r) => r.screen?.score ?? null)
    .filter((s): s is number => s !== null);

  const tokens = (pick: 'totalTokens' | 'inputTokens' | 'outputTokens') =>
    summarize(real.map((r) => r.models.extraction.usage[pick]));
  const screenMs = real.map((r) =>
    r.models.screen.latencyMs ? r.models.screen.latencyMs.reduce((a, b) => a + b, 0) : null,
  );

  return {
    startedAt: run.startedAt,
    relationships: run.relationships,
    realItems: real.length,
    poisonedItems: poisoned.length,
    labels: {
      reviewed: labels.filter((l) => l.status === 'reviewed').length,
      proposed: labels.filter((l) => l.status === 'proposed').length,
    },
    agreement,
    disagreements,
    startNodes: { current, taggedOnly, differences },
    bandSets: BAND_SETS.map((set) => {
      const pairs = (persona: PersonaKey) =>
        real.flatMap((r) => {
          const label = labelOf.get(key(r.item.id, persona));
          return label?.status === 'reviewed'
            ? [
                {
                  label: label.level,
                  predicted: bandWith(set, r.relevance[persona], r.extraction?.importance ?? null),
                },
              ]
            : [];
        });
      return {
        set,
        byPersona: Object.fromEntries(PERSONA_KEYS.map((p) => [p, confusion(pairs(p))])) as Record<
          PersonaKey,
          Confusion
        >,
        total: confusion(PERSONA_KEYS.flatMap(pairs)),
      };
    }),
    byPathKind: PATH_KINDS.map((kind) => {
      const labelsOf = real.flatMap((r) =>
        PERSONA_KEYS.filter((p) => r.pathKinds[p] === kind).flatMap((p) => {
          const label = labelOf.get(key(r.item.id, p));
          return label?.status === 'reviewed' ? [label.level] : [];
        }),
      );
      return {
        kind,
        pairs: labelsOf.length,
        labels: {
          high: labelsOf.filter((l) => l === 'high').length,
          medium: labelsOf.filter((l) => l === 'medium').length,
          none: labelsOf.filter((l) => l === 'none').length,
        },
      };
    }),
    untagged,
    failed: real.flatMap((r) =>
      r.outcome.outcome === 'failed'
        ? [{ sourceId: r.item.id, headline: r.item.item.headline, error: r.outcome.error }]
        : [],
    ),
    gate: { passed, pairs: real.length * PERSONA_KEYS.length },
    injection,
    screen: {
      poisoned: screenCounts(poisoned.map((r) => screenGroup(r.screen))),
      clean: screenCounts(real.map((r) => screenGroup(r.screen))),
      cleanMaxScore: cleanScores.length === 0 ? null : Math.max(...cleanScores),
    },
    cost: {
      totalTokens: tokens('totalTokens'),
      inputTokens: tokens('inputTokens'),
      outputTokens: tokens('outputTokens'),
      screenCalls: summarize(real.map((r) => r.models.screen.chunks.length)),
      screenMs: summarize(screenMs),
      extractionMs: summarize(real.map((r) => r.models.extraction.latencyMs ?? null)),
      codeMs: summarize(real.map((r) => Math.round(r.codeMs))),
      fallbacks: real.filter((r) => r.models.extraction.provider !== 'groq').length,
    },
    edges,
  };
}
