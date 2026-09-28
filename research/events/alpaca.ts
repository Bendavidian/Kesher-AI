// Alpaca historical news over REST (GET /v1beta1/news). No WebSocket: the free plan allows one
// live connection per account, and research must not take it.
// Keys come from .env at runtime and are never printed.
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { z } from 'zod';

export const ROOT = resolve(import.meta.dirname, '..', '..');

// The free plan allows 200 requests per minute; stay well under it.
const MIN_GAP_MS = 400;
let lastRequest = 0;
let keys: { id: string; secret: string } | undefined;

function auth() {
  if (keys) return keys;
  const file = join(ROOT, '.env');
  if (existsSync(file)) process.loadEnvFile(file);
  const parsed = z
    .object({ ALPACA_API_KEY_ID: z.string().min(1), ALPACA_API_SECRET_KEY: z.string().min(1) })
    .safeParse(process.env);
  if (!parsed.success) throw new Error('ALPACA_API_KEY_ID and ALPACA_API_SECRET_KEY must be set');
  keys = { id: parsed.data.ALPACA_API_KEY_ID, secret: parsed.data.ALPACA_API_SECRET_KEY };
  return keys;
}

export const NewsItem = z.object({
  id: z.number(),
  headline: z.string(),
  summary: z.string(),
  author: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  url: z.string().nullable(),
  symbols: z.array(z.string()),
  source: z.string(),
});
export type NewsItem = z.infer<typeof NewsItem>;

const Page = z.object({ news: z.array(NewsItem), next_page_token: z.string().nullable() });

export interface Query {
  symbols?: string[];
  start: string;
  end: string;
  sort?: 'asc' | 'desc';
  max?: number;
}

// Every item in the window, oldest first unless sort says otherwise, up to max items.
export async function news(q: Query): Promise<NewsItem[]> {
  const { id, secret } = auth();
  const items: NewsItem[] = [];
  let token: string | null = null;
  do {
    const qs = new URLSearchParams({
      start: q.start,
      end: q.end,
      limit: '50',
      sort: q.sort ?? 'asc',
      include_content: 'false',
    });
    if (q.symbols?.length) qs.set('symbols', q.symbols.join(','));
    if (token) qs.set('page_token', token);
    const wait = lastRequest + MIN_GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequest = Date.now();
    const res = await fetch(`https://data.alpaca.markets/v1beta1/news?${qs.toString()}`, {
      headers: { 'APCA-API-KEY-ID': id, 'APCA-API-SECRET-KEY': secret },
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Alpaca news HTTP ${res.status}: ${text.slice(0, 200)}`);
    const page = Page.parse(JSON.parse(text));
    items.push(...page.news);
    token = page.next_page_token;
  } while (token && items.length < (q.max ?? 1000));
  return items;
}

// One item by source id. The news API has no id filter, and start and end apply to updated_at,
// not created_at: an item edited after publication (headlines marked "UPDATED") is outside a
// window around its created_at. So the item is looked up in a two second window around its
// updated_at. Replay (T16) needs the same rule.
export async function byId(sourceId: number, updatedAt: string): Promise<NewsItem | undefined> {
  const t = Date.parse(updatedAt);
  const items = await news({
    start: new Date(t - 1000).toISOString(),
    end: new Date(t + 1000).toISOString(),
  });
  return items.find((n) => n.id === sourceId);
}
