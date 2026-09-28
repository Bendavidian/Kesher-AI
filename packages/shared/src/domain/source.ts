import { z } from 'zod';
import { Id, NonBlank, Ticker, Tier } from './common';

export const SourceProvider = z.enum(['alpaca', 'sec_edgar']);
export type SourceProvider = z.infer<typeof SourceProvider>;

export const SourceKind = z.enum(['news', 'filing', 'x_post', 'market_data']);
export type SourceKind = z.infer<typeof SourceKind>;

// A label on the Source. It never decides relevance, gating or writes (principle 3); the score
// is kept only so T16 can tune the threshold without screening again.
export const InjectionScreen = z.strictObject({
  flagged: z.boolean(),
  score: z.number().min(0).max(1).nullable(),
  model: z.string().min(1),
  screenedAt: z.date(),
});
export type InjectionScreen = z.infer<typeof InjectionScreen>;

export const Source = z.strictObject({
  _id: Id,
  provider: SourceProvider,
  kind: SourceKind,
  tier: Tier,
  // The provider's own id: the Alpaca news id or the EDGAR accession number.
  externalId: z.string().min(1),
  url: z.httpUrl(),
  author: NonBlank.nullable(),
  // The outlet that published the item, for example Benzinga for Alpaca news. null for filings.
  publisher: NonBlank.nullable(),
  title: NonBlank,
  // The item body as untrusted data, normalized with normalizeText. null when the provider sent
  // no body, and for filings, whose text lives in FilingChunk.
  text: NonBlank.nullable(),
  // Provider symbols as delivered, which may include companies outside the universe.
  symbols: z.array(Ticker),
  publishedAt: z.date(),
  // null until the item has been screened.
  injectionScreen: InjectionScreen.nullable(),
  createdAt: z.date(),
});
export type Source = z.infer<typeof Source>;
