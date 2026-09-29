import { MAX_STEP_OUTPUT_BYTES } from '@kesher/shared';
import { describe, expect, it } from 'vitest';
import { capStepOutput } from './output';

const bytes = (text: string) => new TextEncoder().encode(text).length;
const noRedaction = (text: string) => text;

describe('capStepOutput', () => {
  it('keeps small output as JSON text', () => {
    expect(capStepOutput({ items: 2 }, noRedaction)).toEqual({
      output: '{"items":2}',
      outputTruncated: false,
    });
  });

  it('keeps a string as it is, not as a JSON string', () => {
    expect(capStepOutput('plain text', noRedaction).output).toBe('plain text');
  });

  it('redacts before it caps, so a secret cut in half is never kept', () => {
    const secret = 'mongodb+srv://user:hunter2@cluster.example';
    const redact = (text: string) => text.split(secret).join('[REDACTED]');
    const padding = 'x'.repeat(MAX_STEP_OUTPUT_BYTES - 20);

    // Capped first, the cut would keep the start of the secret. Redacted first, it fits.
    const { output, outputTruncated } = capStepOutput(`${padding}${secret}`, redact);

    expect(outputTruncated).toBe(false);
    expect(output).toBe(`${padding}[REDACTED]`);
  });

  it('caps at 8,192 bytes without splitting a character', () => {
    // A 3 byte character straddles the limit.
    const text = `${'x'.repeat(MAX_STEP_OUTPUT_BYTES - 1)}€€`;

    const { output, outputTruncated } = capStepOutput(text, noRedaction);

    expect(outputTruncated).toBe(true);
    expect(bytes(output)).toBeLessThanOrEqual(MAX_STEP_OUTPUT_BYTES);
    expect(output).toBe('x'.repeat(MAX_STEP_OUTPUT_BYTES - 1));
    expect(output).not.toContain('�');
  });

  it('keeps output of exactly 8,192 bytes whole', () => {
    const text = 'x'.repeat(MAX_STEP_OUTPUT_BYTES);
    expect(capStepOutput(text, noRedaction)).toEqual({ output: text, outputTruncated: false });
  });

  it('records undefined output as an empty string', () => {
    expect(capStepOutput(undefined, noRedaction)).toEqual({ output: '', outputTruncated: false });
  });
});
