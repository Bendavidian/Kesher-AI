import { UNIVERSE } from '@kesher/shared';
import type { IncomingItem } from './item';

const UNIVERSE_SYMBOLS = new Set<string>(UNIVERSE);

// The pre filter, code only and before any model call (SPEC.md Pipeline): an item passes only
// when its provider symbols include a demo universe company. SPY and SMH are benchmarks, not
// universe companies, and an item with no symbols is dropped.
export function passesUniverse(symbols: readonly string[]): boolean {
  return symbols.some((symbol) => UNIVERSE_SYMBOLS.has(symbol));
}

// The fields a provider can change on an item it sends again.
const PROVIDER_FIELDS = [
  'url',
  'author',
  'publisher',
  'title',
  'text',
  'symbols',
  'publishedAt',
] as const;
type ProviderField = (typeof PROVIDER_FIELDS)[number];

type Comparable = Pick<IncomingItem, ProviderField>;

const sameValue = (field: ProviderField, a: Comparable, b: Comparable): boolean => {
  if (field === 'publishedAt') return a.publishedAt.getTime() === b.publishedAt.getTime();
  if (field === 'symbols') {
    return [...a.symbols].sort().join(',') === [...b.symbols].sort().join(',');
  }
  return a[field] === b[field];
};

// Names only, never values: the result is logged, and item text is untrusted.
export function changedFields(stored: Comparable, incoming: Comparable): ProviderField[] {
  return PROVIDER_FIELDS.filter((field) => !sameValue(field, stored, incoming));
}

// An item that was already processed is never extracted again. Sent unchanged it is a duplicate;
// sent with changes it is an update, which is logged and counted, and the stored version stays.
export function repeatReason(stored: Comparable, incoming: Comparable): 'duplicate' | 'update' {
  return changedFields(stored, incoming).length === 0 ? 'duplicate' : 'update';
}
