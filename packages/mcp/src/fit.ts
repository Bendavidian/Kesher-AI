import { MAX_STEP_OUTPUT_BYTES, utf8Length } from '@kesher/shared';

// What a tool answers stays within 8 KB of JSON in UTF-8, the same cap as a stored run step, so
// the model and the run screen see the same output and a tool result stays near the 2,000 tokens
// the research budget reserves for it (TOOL_RESULT_ALLOWANCE_TOKENS in apps/api).
export const MAX_TOOL_OUTPUT_BYTES = MAX_STEP_OUTPUT_BYTES;

export function outputBytes(output: unknown): number {
  return utf8Length(JSON.stringify(output));
}

// Keeps the longest prefix of the ranked items whose output fits, and says how many were left
// out. Items are dropped whole: a quote or a filing passage is never cut in the middle, because a
// cut quote would no longer be verbatim.
export function fitItems<T, O>(
  items: readonly T[],
  build: (kept: T[], omitted: number) => O,
  max = MAX_TOOL_OUTPUT_BYTES,
): O {
  for (let n = items.length; n > 0; n--) {
    const output = build(items.slice(0, n), items.length - n);
    if (outputBytes(output) <= max) return output;
  }
  return build([], items.length);
}
