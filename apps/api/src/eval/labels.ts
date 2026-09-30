import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { AlpacaNewsId, NonBlank, PersonaKey } from '@kesher/shared';
import { z } from 'zod';
import { EVAL_DIR, type EvalEvent } from './dataset';

// The relevance labels of the eval set, data/evals/labels.json: one per item and persona. A label
// is proposed (written from the SPEC.md rule during research) or reviewed (the user's answer in
// npm run eval:label). Metrics count reviewed labels only; proposed ones are reported apart.

export const LABELS_PATH = resolve(EVAL_DIR, 'labels.json');

export const LEVELS = ['high', 'medium', 'none'] as const;
export const Level = z.enum(LEVELS);
export type Level = z.infer<typeof Level>;

export const PERSONA_KEYS = PersonaKey.options;

export const Label = z.discriminatedUnion('status', [
  z.strictObject({
    sourceId: AlpacaNewsId,
    persona: PersonaKey,
    level: Level,
    status: z.literal('proposed'),
    reason: NonBlank,
  }),
  z.strictObject({
    sourceId: AlpacaNewsId,
    persona: PersonaKey,
    level: Level,
    status: z.literal('reviewed'),
    // The label proposed before the review, kept to show how often the review changed it.
    proposed: Level,
    decidedAt: z.iso.datetime(),
  }),
]);
export type Label = z.infer<typeof Label>;

export const LabelsFile = z.strictObject({ labels: z.array(Label) });

export async function loadLabels(path = LABELS_PATH): Promise<Label[]> {
  return LabelsFile.parse(JSON.parse(await readFile(path, 'utf8'))).labels;
}

const labelKey = (sourceId: string, persona: PersonaKey) => `${sourceId}/${persona}`;

// Every item has exactly one label per persona, and every label belongs to an item of the set.
export function checkLabels(events: readonly EvalEvent[], labels: readonly Label[]): string[] {
  const problems: string[] = [];
  const ids = new Set(events.map((e) => e.id));
  const seen = new Set<string>();
  for (const label of labels) {
    const key = labelKey(label.sourceId, label.persona);
    if (!ids.has(label.sourceId)) problems.push(`${key}: not an eval item`);
    if (seen.has(key)) problems.push(`${key}: labeled twice`);
    seen.add(key);
  }
  for (const event of events) {
    for (const persona of PERSONA_KEYS) {
      if (!seen.has(labelKey(event.id, persona))) problems.push(`${event.id}/${persona}: no label`);
    }
  }
  return problems;
}

// The items still to review, in the file's order: any with a persona not reviewed yet. redo
// asks about one item again, reviewed or not.
export function pendingItems(
  events: readonly EvalEvent[],
  labels: readonly Label[],
  redo?: string,
): EvalEvent[] {
  if (redo !== undefined) return events.filter((e) => e.id === redo);
  const reviewed = new Set(
    labels.filter((l) => l.status === 'reviewed').map((l) => labelKey(l.sourceId, l.persona)),
  );
  return events.filter((e) => PERSONA_KEYS.some((p) => !reviewed.has(labelKey(e.id, p))));
}

// Replaces the item's three labels with reviewed ones, keeping the file's order.
export function recordReview(
  labels: readonly Label[],
  sourceId: string,
  answers: Record<PersonaKey, Level>,
  now: Date,
): Label[] {
  if (!labels.some((l) => l.sourceId === sourceId)) throw new Error(`no labels for ${sourceId}`);
  return labels.map((label) => {
    if (label.sourceId !== sourceId) return label;
    return {
      sourceId,
      persona: label.persona,
      level: answers[label.persona],
      status: 'reviewed',
      proposed: label.status === 'proposed' ? label.level : label.proposed,
      decidedAt: now.toISOString(),
    };
  });
}

export type LevelInput = { kind: 'level'; level: Level } | { kind: 'skip' } | { kind: 'quit' };

// h, m or n (or the full word); s skips the item, q quits. null for anything else.
export function parseLevel(input: string): LevelInput | null {
  const answer = input.trim().toLowerCase();
  if (answer === 's' || answer === 'skip') return { kind: 'skip' };
  if (answer === 'q' || answer === 'quit') return { kind: 'quit' };
  const level = LEVELS.find((l) => l === answer || l[0] === answer);
  return level ? { kind: 'level', level } : null;
}
