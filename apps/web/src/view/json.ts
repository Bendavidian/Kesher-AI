// Pretty printed JSON as colored tokens for the step detail panel (docs/UI.md, Agent run
// screen): keys supplier-light, strings code, numbers model.

export type JsonTokenKind = 'key' | 'string' | 'number' | 'literal' | 'punct';

export interface JsonToken {
  text: string;
  kind: JsonTokenKind;
}

// A nested object or array stays on one line while it fits in this many characters.
const INLINE_WIDTH = 80;

const punct = (text: string): JsonToken => ({ text, kind: 'punct' });

function scalar(value: unknown): JsonToken {
  if (typeof value === 'string') return { text: JSON.stringify(value), kind: 'string' };
  if (typeof value === 'number') return { text: String(value), kind: 'number' };
  if (typeof value === 'boolean' || value === null) return { text: String(value), kind: 'literal' };
  // Dates, and anything else JSON can print; undefined, functions and bigints fall back to text.
  try {
    return { text: JSON.stringify(value) ?? 'null', kind: 'string' };
  } catch {
    const text = typeof value === 'bigint' ? value.toString() : 'unprintable';
    return { text: JSON.stringify(text), kind: 'string' };
  }
}

type Entry = [JsonToken | null, unknown];

function entries(value: object): Entry[] {
  if (Array.isArray(value)) return value.map((item): Entry => [null, item]);
  return Object.entries(value).map(([key, item]): Entry => [
    { text: JSON.stringify(key), kind: 'key' },
    item,
  ]);
}

const isContainer = (value: unknown): value is object =>
  typeof value === 'object' && value !== null && !(value instanceof Date);

function inline(value: unknown): JsonToken[] {
  if (!isContainer(value)) return [scalar(value)];
  const [open, close] = Array.isArray(value) ? ['[', ']'] : ['{', '}'];
  const items = entries(value);
  if (items.length === 0) return [punct(`${open}${close}`)];
  const body = items.flatMap(([key, item], index) => [
    ...(index > 0 ? [punct(', ')] : []),
    ...(key ? [key, punct(': ')] : []),
    ...inline(item),
  ]);
  return [punct(`${open} `), ...body, punct(` ${close}`)];
}

const width = (tokens: JsonToken[]) => tokens.reduce((sum, token) => sum + token.text.length, 0);

function block(value: unknown, depth: number): JsonToken[] {
  const flat = inline(value);
  if (!isContainer(value) || (depth > 0 && depth * 2 + width(flat) <= INLINE_WIDTH)) return flat;
  const items = entries(value);
  if (items.length === 0) return flat;
  const [open, close] = Array.isArray(value) ? ['[', ']'] : ['{', '}'];
  const pad = '  '.repeat(depth + 1);
  const body = items.flatMap(([key, item], index) => [
    punct(`\n${pad}`),
    ...(key ? [key, punct(': ')] : []),
    ...block(item, depth + 1),
    ...(index < items.length - 1 ? [punct(',')] : []),
  ]);
  return [punct(open), ...body, punct(`\n${'  '.repeat(depth)}${close}`)];
}

export function jsonTokens(value: unknown): JsonToken[] {
  return block(value, 0);
}
