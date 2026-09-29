import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { UniverseSymbol, UNIVERSE } from '@kesher/shared';
import { z } from 'zod';
import { RECORDINGS_DIR } from '../ingest/recordings';
import type { CompanySeed } from '../seed/config';

// Finnhub peers and profiles, recorded once to recordings/finnhub/<symbol>.json. Peers inside the
// universe only flag candidates (a competitor_of edge still needs a filing quote); the profile is
// only compared with the seed, which owns the company fields (SPEC.md decision log, T11).

const BASE = 'https://finnhub.io/api/v1';
// The free plan allows 60 calls per minute.
const MIN_GAP_MS = 1_100;

export const FinnhubProfile = z.object({
  name: z.string(),
  ticker: z.string(),
  exchange: z.string(),
  country: z.string(),
  finnhubIndustry: z.string(),
});
export type FinnhubProfile = z.infer<typeof FinnhubProfile>;

export const FinnhubRecording = z.strictObject({
  symbol: UniverseSymbol,
  recordedAt: z.iso.datetime(),
  peers: z.array(z.string()),
  profile: FinnhubProfile.strict(),
});
export type FinnhubRecording = z.infer<typeof FinnhubRecording>;

export function finnhubRecordingPath(symbol: UniverseSymbol, dir = RECORDINGS_DIR): string {
  return join(dir, 'finnhub', `${UniverseSymbol.parse(symbol)}.json`);
}

export async function loadFinnhubRecording(
  symbol: UniverseSymbol,
  dir = RECORDINGS_DIR,
): Promise<FinnhubRecording | null> {
  let contents: string;
  try {
    contents = await readFile(finnhubRecordingPath(symbol, dir), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  return FinnhubRecording.parse(JSON.parse(contents));
}

export function finnhubClient(
  token: string,
): (symbol: UniverseSymbol) => Promise<FinnhubRecording> {
  let lastRequest = 0;
  const get = async (path: string): Promise<unknown> => {
    const wait = lastRequest + MIN_GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequest = Date.now();
    // The token goes in a header, never in the URL.
    const res = await fetch(`${BASE}${path}`, {
      headers: { 'X-Finnhub-Token': token },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} from Finnhub ${path}`);
    return res.json();
  };
  return async (symbol) => {
    const peers = z.array(z.string()).parse(await get(`/stock/peers?symbol=${symbol}`));
    const profile = FinnhubProfile.parse(await get(`/stock/profile2?symbol=${symbol}`));
    return FinnhubRecording.parse({
      symbol,
      recordedAt: new Date().toISOString(),
      peers,
      profile: {
        name: profile.name,
        ticker: profile.ticker,
        exchange: profile.exchange,
        country: profile.country,
        finnhubIndustry: profile.finnhubIndustry,
      },
    });
  };
}

const IN_UNIVERSE = new Set<string>(UNIVERSE);

// Unordered pairs of universe companies that Finnhub lists as peers, from either side.
export function peerPairs(recordings: readonly FinnhubRecording[]): Set<string> {
  const pairs = new Set<string>();
  for (const { symbol, peers } of recordings) {
    for (const peer of peers) {
      if (peer !== symbol && IN_UNIVERSE.has(peer)) pairs.add([symbol, peer].sort().join('|'));
    }
  }
  return pairs;
}

export const peerKey = (a: UniverseSymbol, b: UniverseSymbol) => [a, b].sort().join('|');

const snake = (industry: string) =>
  industry
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');

// Differences between the Finnhub profile and the seeded company, for the job to print. The seed
// owns these fields; nothing here writes them.
export function profileDiffs(seed: CompanySeed, recording: FinnhubRecording): string[] {
  const diffs: string[] = [];
  const { profile } = recording;
  if (profile.ticker !== seed.primaryListing) {
    diffs.push(`primaryListing: seed ${seed.primaryListing}, Finnhub ${profile.ticker}`);
  }
  if (profile.name.toLowerCase() !== seed.name.toLowerCase()) {
    diffs.push(`name: seed "${seed.name}", Finnhub "${profile.name}"`);
  }
  if (snake(profile.finnhubIndustry) !== seed.sector) {
    diffs.push(`sector: seed ${seed.sector}, Finnhub ${snake(profile.finnhubIndustry)}`);
  }
  return diffs;
}
