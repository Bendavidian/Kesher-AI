import { createHash } from 'node:crypto';
import type { Source, SourceProvider } from '@kesher/shared';
import type { Collection } from 'mongodb';

// Sources that a tool names before they are stored: the price reaction a get_price_reaction call
// computed, a filing that get_financial_facts cites. The tool stays read only; after the call the
// research agent's code stores the Source under the same id, so the claim that cites it passes
// sources_exist (SPEC.md decision log, T13).

// A fixed namespace for Kesher source ids; any other UUID would do, but it must never change.
const NAMESPACE = Buffer.from('5b0e8c2a4f1d4e6b9a3c7d2e1f0a9b8c', 'hex');

// An RFC 9562 version 5 UUID of the name: the same name always gives the same id.
export function nameUuid(name: string): string {
  const hash = createHash('sha1').update(NAMESPACE).update(name, 'utf8').digest();
  hash[6] = (hash[6]! & 0x0f) | 0x50;
  hash[8] = (hash[8]! & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export const sourceIdName = (provider: SourceProvider, externalId: string) =>
  `${provider}:${externalId}`;

// The id of the stored Source with this provider id, or the one it will be stored under.
export async function sourceIdFor(
  sources: Collection<Source>,
  provider: SourceProvider,
  externalId: string,
): Promise<string> {
  const stored = await sources.findOne({ provider, externalId }, { projection: { _id: 1 } });
  return stored?._id ?? nameUuid(sourceIdName(provider, externalId));
}
