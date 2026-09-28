import { describe, expect, it, vi } from 'vitest';
import { AlpacaNewsItem, fetchAlpacaNewsById, toIncomingItem } from './alpaca';

const raw = {
  id: 38062166,
  headline: 'TSMC Suspends Chip Production After Taiwan Rocked By Strongest Tremor In 25 Years',
  summary: 'Taiwan was struck by a powerful 7.2&nbsp;magnitude <b>earthquake</b> on Wednesday.',
  author: 'Benzinga Neuro',
  created_at: '2024-04-03T03:57:09Z',
  updated_at: '2024-04-03T03:57:10Z',
  url: 'https://www.benzinga.com/news/24/04/38062166/taiwan-earthquake',
  symbols: ['TSM'],
  source: 'benzinga',
  images: [],
};

describe('toIncomingItem', () => {
  it('maps an Alpaca item to a Tier 2 news Source keyed by the Alpaca id', () => {
    expect(toIncomingItem(AlpacaNewsItem.parse(raw))).toEqual({
      provider: 'alpaca',
      kind: 'news',
      tier: 2,
      externalId: '38062166',
      url: raw.url,
      author: 'Benzinga Neuro',
      publisher: 'Benzinga',
      title: raw.headline,
      text: 'Taiwan was struck by a powerful 7.2 magnitude earthquake on Wednesday.',
      symbols: ['TSM'],
      publishedAt: new Date('2024-04-03T03:57:09Z'),
    });
  });

  it('turns a blank author and an empty summary into null', () => {
    const item = toIncomingItem(AlpacaNewsItem.parse({ ...raw, author: ' ', summary: '<p></p>' }));
    expect(item.author).toBeNull();
    expect(item.text).toBeNull();
  });

  it('names the publisher from the provider source, trimmed, null when blank', () => {
    const publisher = (source: string) =>
      toIncomingItem(AlpacaNewsItem.parse({ ...raw, source })).publisher;
    expect(publisher('benzinga')).toBe('Benzinga');
    expect(publisher(' Reuters ')).toBe('Reuters');
    expect(publisher('  ')).toBeNull();
  });
});

describe('AlpacaNewsItem', () => {
  it('rejects items without an integer id or a valid time', () => {
    expect(AlpacaNewsItem.safeParse({ ...raw, id: '38062166' }).success).toBe(false);
    expect(AlpacaNewsItem.safeParse({ ...raw, created_at: 'yesterday' }).success).toBe(false);
    expect(AlpacaNewsItem.safeParse({ ...raw, headline: undefined }).success).toBe(false);
  });
});

describe('fetchAlpacaNewsById', () => {
  const keys = { keyId: 'test-key-id', secretKey: 'test-secret' };
  const decoy = { ...raw, id: 38062000, headline: raw.headline };
  const page = (news: unknown[], next: string | null) =>
    new Response(JSON.stringify({ news, next_page_token: next }), { status: 200 });

  it('selects the item by id across pages, never by headline, and drops content', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(page([decoy], 'page-2'))
      .mockResolvedValueOnce(page([{ ...raw, content: '<p>full article</p>' }], null));

    const item = await fetchAlpacaNewsById({
      id: 38062166,
      symbol: 'TSM',
      date: '2024-04-03',
      keys,
      fetch,
    });

    expect(item.id).toBe(38062166);
    expect(item).not.toHaveProperty('content');
    expect(AlpacaNewsItem.parse(item).headline).toBe(raw.headline);
    expect(fetch).toHaveBeenCalledTimes(2);
    const first = new URL(fetch.mock.calls[0]![0] as string);
    expect(Object.fromEntries(first.searchParams)).toMatchObject({
      symbols: 'TSM',
      start: '2024-04-03T00:00:00.000Z',
      end: '2024-04-04T00:00:00.000Z',
      include_content: 'false',
    });
    expect(new URL(fetch.mock.calls[1]![0] as string).searchParams.get('page_token')).toBe(
      'page-2',
    );
  });

  it('throws when the id is not in the window', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(page([decoy], null));
    await expect(
      fetchAlpacaNewsById({ id: 38062166, symbol: 'TSM', date: '2024-04-03', keys, fetch }),
    ).rejects.toThrow(/not found/);
  });

  it('reports an error status without echoing the keys', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response('forbidden', { status: 403 }));
    const error = await fetchAlpacaNewsById({
      id: 1,
      symbol: 'TSM',
      date: '2024-04-03',
      keys,
      fetch,
    }).catch((e: unknown) => e as Error);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('Alpaca news answered 403');
    expect((error as Error).message).not.toContain(keys.secretKey);
  });
});
