import { nameUuid, sourceIdName } from '@kesher/mcp';
import { priceReactionExternalId, priceReactionSource, type PriceReaction } from '@kesher/shared';
import type { Db } from 'mongodb';
import { collection } from '../db/collections';
import { retryOnDuplicateKey } from '../db/retry';

// The one writer of price reaction Sources (SPEC.md decision log, T13). Any code that cites a
// price reaction, such as a claim's check, stores its Source through this function, so equal
// reactions share one Source under one id: the id get_price_reaction names in its output.
// Idempotent: the unique (provider, externalId) index keeps one document, and a second call only
// refreshes the text, which changes while a session is still under way.
export async function upsertPriceReactionSource(
  db: Db,
  reaction: PriceReaction,
  now: Date,
): Promise<string> {
  const externalId = priceReactionExternalId(reaction);
  const { text, title, ...insertOnly } = priceReactionSource(
    reaction,
    nameUuid(sourceIdName('alpaca', externalId)),
    now,
  );
  const sources = collection(db, 'sources');
  // Two runs storing the same reaction at once: the retry matches the Source the other inserted.
  const stored = await retryOnDuplicateKey(() =>
    sources.findOneAndUpdate(
      { provider: 'alpaca', externalId },
      { $setOnInsert: insertOnly, $set: { text, title } },
      { upsert: true, returnDocument: 'after', projection: { _id: 1 } },
    ),
  );
  if (!stored) throw new Error(`no Source for ${externalId}`);
  return stored._id;
}
