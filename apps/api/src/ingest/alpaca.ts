import { normalizeText, Ticker, type AlpacaNewsItem } from '@kesher/shared';
import { z } from 'zod';
import type { IncomingItem } from './item';

// The item schema lives in packages/shared with the LiveRecording that stores it.
export { AlpacaNewsItem } from '@kesher/shared';

// Display names for the publishers Alpaca reports in lower case. Any other value is kept as sent.
const PUBLISHER_NAMES: Record<string, string> = { benzinga: 'Benzinga' };

function publisherName(source: string): string | null {
  const trimmed = source.trim();
  if (trimmed === '') return null;
  return PUBLISHER_NAMES[trimmed.toLowerCase()] ?? trimmed;
}

// Alpaca news is Benzinga, a wire: Tier 2 (SPEC.md Source tiers). Everything here is untrusted
// data; ingestItem validates the result against the Source schema before any write.
export function toIncomingItem(item: AlpacaNewsItem): IncomingItem {
  const author = item.author.trim();
  const text = normalizeText(item.summary);
  return {
    provider: 'alpaca',
    kind: 'news',
    tier: 2,
    externalId: String(item.id),
    url: item.url,
    author: author === '' ? null : author,
    publisher: publisherName(item.source),
    title: normalizeText(item.headline),
    text: text === '' ? null : text,
    // A malformed provider symbol (lower case, a slash) is dropped here rather than rejecting the
    // whole item in ingestItem; the pre filter reads what is left.
    symbols: item.symbols.filter((symbol) => Ticker.safeParse(symbol).success),
    publishedAt: new Date(item.created_at),
  };
}

export const ALPACA_NEWS_URL = 'https://data.alpaca.markets/v1beta1/news';
const MAX_PAGES = 20;

const NewsPage = z.object({
  news: z.array(z.looseObject({ id: z.int() })),
  next_page_token: z.string().nullish(),
});

export interface AlpacaKeys {
  keyId: string;
  secretKey: string;
}

export interface FetchNewsByIdOptions {
  id: number;
  // The history endpoint has no id filter, so the item is looked up in one symbol's news for
  // one UTC day, then selected by id. Never by headline or keyword (SPEC.md Replay).
  symbol: string;
  date: string;
  keys: AlpacaKeys;
  fetch?: typeof globalThis.fetch;
}

// Returns the raw item as Alpaca sent it, without content, so a recording keeps the provider's
// shape. Throws when the id is not in that window.
export async function fetchAlpacaNewsById({
  id,
  symbol,
  date,
  keys,
  fetch = globalThis.fetch,
}: FetchNewsByIdOptions): Promise<Record<string, unknown>> {
  const start = new Date(`${date}T00:00:00Z`);
  const end = new Date(start.getTime() + 24 * 3_600_000);
  let pageToken: string | null | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const query = new URLSearchParams({
      symbols: symbol,
      start: start.toISOString(),
      end: end.toISOString(),
      limit: '50',
      sort: 'asc',
      include_content: 'false',
    });
    if (pageToken) query.set('page_token', pageToken);
    const response = await fetch(`${ALPACA_NEWS_URL}?${query.toString()}`, {
      headers: { 'APCA-API-KEY-ID': keys.keyId, 'APCA-API-SECRET-KEY': keys.secretKey },
    });
    if (!response.ok) throw new Error(`Alpaca news answered ${response.status}`);
    const body = NewsPage.parse(await response.json());
    const match = body.news.find((item) => item.id === id);
    if (match) {
      const raw: Record<string, unknown> = { ...match };
      delete raw.content;
      return raw;
    }
    pageToken = body.next_page_token;
    if (!pageToken) break;
  }
  throw new Error(`Alpaca news ${id} not found for ${symbol} on ${date}`);
}
