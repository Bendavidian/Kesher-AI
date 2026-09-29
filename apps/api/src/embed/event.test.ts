import { describe, expect, it } from 'vitest';
import { fakeEmbedder } from '../test/embedder';
import { eventEmbeddingText } from './event';
import { MAX_CHUNK_TOKENS } from './local';

describe('eventEmbeddingText', () => {
  const embedder = fakeEmbedder();

  it('keeps the headline and a body that fits', () => {
    expect(eventEmbeddingText(embedder, ' TSMC halts fabs ', 'After the  quake.')).toBe(
      'TSMC halts fabs. After the quake.',
    );
  });

  it('uses the headline alone without a body', () => {
    expect(eventEmbeddingText(embedder, 'TSMC halts fabs', null)).toBe('TSMC halts fabs');
  });

  it('cuts a long body on a word boundary to the most that fits 256 word pieces', () => {
    const body = Array.from({ length: 1_000 }, (_, i) => `w${i}`).join(' ');
    const text = eventEmbeddingText(embedder, 'TSMC halts fabs', body);
    expect(embedder.countTokens(text)).toBe(MAX_CHUNK_TOKENS);
    expect(text.endsWith(' w250')).toBe(true);
  });
});
