import type { InjectionScreen, Source } from '@kesher/shared';
import { z } from 'zod';
import type { ModelClient } from '../llm/client';

// Prompt guard 2 reads at most 512 tokens. About 1,200 characters stays well inside that.
export const CHUNK_CHARS = 1_200;

// A label threshold, not a decision: the screen never decides relevance, gating or writes
// (SPEC.md Pipeline). The score is stored too, so T16 can tune this without screening again.
export const FLAG_THRESHOLD = 0.5;

// The untrusted text of an item: title and body.
export function screenInput(source: Pick<Source, 'title' | 'text'>): string {
  return source.text === null ? source.title : `${source.title}\n\n${source.text}`;
}

// Splits on whitespace into chunks of at most CHUNK_CHARS; a longer word is cut.
export function chunkText(text: string, max = CHUNK_CHARS): string[] {
  const chunks: string[] = [];
  let current = '';
  for (let word of text.split(/\s+/).filter(Boolean)) {
    while (word.length > max) {
      if (current) chunks.push(current);
      chunks.push(word.slice(0, max));
      word = word.slice(max);
      current = '';
    }
    if (!word) continue;
    if (current && current.length + 1 + word.length > max) {
      chunks.push(current);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

// Prompt guard answers with the probability that the text is an attack.
const Score = z
  .string()
  .trim()
  .regex(/^\d+(\.\d+)?(e-?\d+)?$/i)
  .transform(Number)
  .pipe(z.number().min(0).max(1));

export function parseScore(raw: string): number {
  return Score.parse(raw);
}

// Screens each chunk in turn and keeps the highest score.
export async function screenText(
  client: ModelClient,
  text: string,
  now = new Date(),
): Promise<InjectionScreen> {
  let score = 0;
  let model: string | undefined;
  for (const chunk of chunkText(text)) {
    const answer = await client.screenChunk(chunk);
    score = Math.max(score, parseScore(answer.text));
    model = answer.model;
  }
  if (model === undefined) throw new Error('nothing to screen');
  return { flagged: score >= FLAG_THRESHOLD, score, model, screenedAt: now };
}
