import { MAX_STEP_OUTPUT_BYTES, utf8Length } from '@kesher/shared';

// A step's output as stored in the AgentRun: JSON text (a string stays as it is), redacted first
// so the cap can never keep half a secret, then cut to 8 KB of UTF-8 on a character boundary.
export function capStepOutput(
  value: unknown,
  redact: (text: string) => string,
): { output: string; outputTruncated: boolean } {
  const text = typeof value === 'string' ? value : (JSON.stringify(value) ?? '');
  const redacted = redact(text);
  if (utf8Length(redacted) <= MAX_STEP_OUTPUT_BYTES) {
    return { output: redacted, outputTruncated: false };
  }
  let size = 0;
  let end = 0;
  for (const char of redacted) {
    const charBytes = utf8Length(char);
    if (size + charBytes > MAX_STEP_OUTPUT_BYTES) break;
    size += charBytes;
    end += char.length;
  }
  return { output: redacted.slice(0, end), outputTruncated: true };
}
