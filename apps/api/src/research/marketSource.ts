import { randomUUID } from 'node:crypto';
import { REACTION_BENCHMARKS, type PriceSymbol } from '@kesher/shared';
import type { Db } from 'mongodb';
import { collection } from '../db/collections';

// The Source a metric claim cites: the SIP minute bars behind the event's price reaction. It holds
// no bars and no text, only which symbols were read, since raw bars stay out of the database and
// out of git (SPEC.md decision log, T13). Written by code, one per event and set of symbols, so
// its name lists exactly the symbols a report's metrics read.

export const MARKET_DATA_URL = 'https://data.alpaca.markets/v2/stocks/bars';

export const marketSourceExternalId = (eventId: string, symbols: readonly PriceSymbol[]) =>
  `sip-bars:${eventId}:${symbols.join(',')}`;

// The symbols in reaction order: subjects first, then SMH and SPY.
export function marketSymbols(subjects: readonly PriceSymbol[]): PriceSymbol[] {
  const benchmarks: readonly PriceSymbol[] = REACTION_BENCHMARKS;
  return [...new Set(subjects.filter((s) => !benchmarks.includes(s))), ...REACTION_BENCHMARKS];
}

// The market data Source for the event and these symbols, created on first use.
export async function upsertMarketSource(
  db: Db,
  eventId: string,
  subjects: readonly PriceSymbol[],
  { now = new Date(), newId = randomUUID }: { now?: Date; newId?: () => string } = {},
): Promise<string> {
  const symbols = marketSymbols(subjects);
  const key = { provider: 'alpaca' as const, externalId: marketSourceExternalId(eventId, symbols) };
  const upsert = () =>
    collection(db, 'sources').findOneAndUpdate(
      key,
      {
        $setOnInsert: {
          _id: newId(),
          kind: 'market_data',
          // Exchange data through the consolidated tape, the primary record of the prices.
          tier: 1,
          url: MARKET_DATA_URL,
          author: null,
          publisher: null,
          title: 'SIP minute bars',
          symbols,
          text: null,
          publishedAt: now,
          // Numbers read by code, not text: nothing to screen.
          injectionScreen: null,
          createdAt: now,
        },
      },
      { upsert: true, returnDocument: 'after' },
    );
  // Two runs on one event may insert at once; the unique (provider, externalId) index lets one
  // win, and the other reads what it wrote.
  const source = await upsert().catch((error: unknown) => {
    if ((error as { code?: number }).code === 11000) return upsert();
    throw error;
  });
  if (!source) throw new Error(`the market data source for event ${eventId} was not written`);
  return source._id;
}
