import { nameUuid, sourceIdName } from '@kesher/mcp';
import { Source, type UniverseSymbol } from '@kesher/shared';
import type { Db } from 'mongodb';
import { collection } from '../db/collections';
import { retryOnDuplicateKey } from '../db/retry';

export interface CitedFiling {
  accn: string;
  form: string;
  filed: string;
  url: string;
  title: string;
}

// Stores the filing Source an XBRL value cites (get_financial_facts), once, keyed by accession
// number (SPEC.md decision log, T13). A filing already stored, for example a 10-K the graph job
// inserted, is left as it is and keeps its id; a new one gets the id the tool named. Filing text
// is never stored on the Source.
export async function upsertFilingSource(
  db: Db,
  symbol: UniverseSymbol,
  filing: CitedFiling,
  now: Date,
): Promise<string> {
  const { _id, provider, externalId, ...insertOnly } = Source.parse({
    _id: nameUuid(sourceIdName('sec_edgar', filing.accn)),
    provider: 'sec_edgar',
    kind: 'filing',
    tier: 1,
    externalId: filing.accn,
    url: filing.url,
    author: null,
    publisher: null,
    title: filing.title,
    text: null,
    symbols: [symbol],
    publishedAt: new Date(`${filing.filed}T00:00:00Z`),
    injectionScreen: null,
    createdAt: now,
  });
  const stored = await retryOnDuplicateKey(() =>
    collection(db, 'sources').findOneAndUpdate(
      { provider, externalId },
      { $setOnInsert: { _id, ...insertOnly } },
      { upsert: true, returnDocument: 'after', projection: { _id: 1 } },
    ),
  );
  if (!stored) throw new Error(`no Source for filing ${filing.accn}`);
  return stored._id;
}
