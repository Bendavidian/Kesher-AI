import { z } from 'zod';
import { Id } from './common';

// One Alpaca news item as the REST history endpoint and the news WebSocket deliver it. Unknown
// keys (images, content, the stream's T) are allowed on input and dropped on parse, so the article
// body never reaches a recording.
export const AlpacaNewsItem = z.object({
  id: z.int().positive(),
  headline: z.string(),
  summary: z.string(),
  author: z.string(),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
  url: z.string(),
  // Filtered against the Ticker schema by toIncomingItem, so one malformed provider symbol
  // never rejects the whole item.
  symbols: z.array(z.string()),
  source: z.string(),
});
export type AlpacaNewsItem = z.infer<typeof AlpacaNewsItem>;

// An Alpaca news id. Digits only, so an id can never step outside the recordings directory.
export const AlpacaNewsId = z.string().regex(/^\d{1,20}$/);

// An EDGAR accession number, 0001045810-26-000021. Digits and dashes only, for the same reason.
export const AccessionNumber = z.string().regex(/^\d{10}-\d{2}-\d{6}$/);

// An 8-K item code, 2.02. The only filing field that reaches the Source title besides the form.
export const FilingItemCode = z.string().regex(/^\d{1,2}\.\d{2}$/);

// One filing from the filer's EDGAR submissions (filings.recent), as the poller reads it. cik is
// the filer's CIK, padded to 10 digits as Company.cik stores it. items lists the 8-K item codes,
// comma separated, empty for other forms.
export const EdgarFiling = z.strictObject({
  cik: z.string().regex(/^\d{10}$/),
  accessionNumber: AccessionNumber,
  form: z.string().regex(/^[\w/-]{1,12}$/),
  filingDate: z.iso.date(),
  acceptanceDateTime: z.iso.datetime({ offset: true }),
  // A file name inside the filing folder: no path separators, never . or ..
  primaryDocument: z
    .string()
    .max(200)
    .regex(/^(?!\.\.?$)[\w.-]+$/),
  items: z
    .string()
    .max(200)
    .refine(
      (items) =>
        items === '' || items.split(',').every((code) => FilingItemCode.safeParse(code).success),
      {
        error: 'items must be comma separated 8-K item codes',
      },
    ),
});
export type EdgarFiling = z.infer<typeof EdgarFiling>;

// A live item that passed the pre filter, kept as the provider sent it (without the article
// body) so it can be replayed later through the same pipeline. The first recording of an id is
// kept; a later update to it is not recorded again.
export const LiveRecording = z.discriminatedUnion('provider', [
  z.strictObject({
    _id: Id,
    provider: z.literal('alpaca'),
    externalId: AlpacaNewsId,
    recordedAt: z.date(),
    item: AlpacaNewsItem,
  }),
  z.strictObject({
    _id: Id,
    provider: z.literal('sec_edgar'),
    externalId: AccessionNumber,
    recordedAt: z.date(),
    item: EdgarFiling,
  }),
]);
export type LiveRecording = z.infer<typeof LiveRecording>;
