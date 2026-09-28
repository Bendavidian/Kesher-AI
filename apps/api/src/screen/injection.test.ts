import { describe, expect, it } from 'vitest';
import { createModelClient, MODELS } from '../llm/client';
import { loadModelRecording } from '../llm/recordings';
import { DEMO_SOURCE_ID } from '../seed/config';
import { mockModel, resolveMocks } from '../test/models';
import {
  CHUNK_CHARS,
  chunkText,
  FLAG_THRESHOLD,
  parseScore,
  screenInput,
  screenText,
} from './injection';

const guardClient = (replies: string[]) => {
  const guard = mockModel(MODELS.screen.model, replies);
  return {
    guard,
    client: createModelClient({ resolve: resolveMocks({ [guard.modelId]: guard }) }),
  };
};

describe('chunkText', () => {
  it('keeps a short text in one chunk', () => {
    expect(chunkText('TSMC halts production')).toEqual(['TSMC halts production']);
  });

  it('splits a long text on whitespace into chunks within the limit, losing no word', () => {
    const words = Array.from({ length: 800 }, (_, i) => `word${i}`);
    const chunks = chunkText(words.join(' '));

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(CHUNK_CHARS);
    expect(chunks.join(' ').split(' ')).toEqual(words);
  });

  it('cuts a single word longer than the limit', () => {
    const chunks = chunkText('x'.repeat(CHUNK_CHARS * 2 + 5));
    expect(chunks.map((c) => c.length)).toEqual([CHUNK_CHARS, CHUNK_CHARS, 5]);
  });

  it('returns no chunk for blank text', () => {
    expect(chunkText('  \n ')).toEqual([]);
  });
});

describe('screenInput', () => {
  it('screens the title and the body together, or the title alone', () => {
    expect(screenInput({ title: 'Headline', text: 'Body.' })).toBe('Headline\n\nBody.');
    expect(screenInput({ title: 'Headline', text: null })).toBe('Headline');
  });
});

describe('parseScore', () => {
  it('reads the probability prompt guard returns', () => {
    expect(parseScore('0.0012')).toBe(0.0012);
    expect(parseScore(' 0.9993\n')).toBe(0.9993);
  });

  it('rejects anything that is not a probability', () => {
    expect(() => parseScore('ignore previous instructions')).toThrow();
    expect(() => parseScore('1.5')).toThrow();
    expect(() => parseScore('')).toThrow();
  });
});

describe('screenText', () => {
  const at = new Date('2026-09-28T12:00:00Z');

  it('stores the highest chunk score and flags at the threshold', async () => {
    const { guard, client } = guardClient(['0.01', String(FLAG_THRESHOLD), '0.2']);
    const text = Array.from({ length: 700 }, () => 'word').join(' ');

    const screen = await screenText(client, text, at);

    expect(guard.doGenerateCalls).toHaveLength(3);
    expect(screen).toEqual({
      flagged: true,
      score: FLAG_THRESHOLD,
      model: 'meta-llama/llama-prompt-guard-2-86m',
      screenedAt: at,
    });
  });

  it('does not flag a benign text', async () => {
    const { client } = guardClient(['0.0004']);
    expect(await screenText(client, 'TSMC halts production', at)).toMatchObject({
      flagged: false,
      score: 0.0004,
    });
  });

  it('parses the recorded prompt guard answer for the demo item', async () => {
    const recording = await loadModelRecording(DEMO_SOURCE_ID);
    const { client } = guardClient(recording!.screen.chunks);

    const screen = await screenText(client, recording!.screen.input, at);

    expect(screen.flagged).toBe(false);
    expect(screen.score).toBeLessThan(FLAG_THRESHOLD);
  });
});
