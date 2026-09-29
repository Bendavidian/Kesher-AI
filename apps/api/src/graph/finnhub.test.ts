import { describe, expect, it } from 'vitest';
import { COMPANIES } from '../seed/config';
import { peerPairs, profileDiffs, type FinnhubRecording } from './finnhub';

const recording = (
  symbol: FinnhubRecording['symbol'],
  peers: string[],
  profile: Partial<FinnhubRecording['profile']> = {},
): FinnhubRecording => ({
  symbol,
  recordedAt: '2026-09-29T12:00:00.000Z',
  peers,
  profile: {
    name: 'NVIDIA Corp',
    ticker: symbol,
    exchange: 'NASDAQ NMS - GLOBAL MARKET',
    country: 'US',
    finnhubIndustry: 'Semiconductors',
    ...profile,
  },
});

describe('peerPairs', () => {
  it('keeps unordered pairs inside the universe from either side', () => {
    const pairs = peerPairs([
      recording('NVDA', ['NVDA', 'AVGO', 'MRVL', 'AMD']),
      recording('AMD', ['NVDA']),
    ]);
    expect([...pairs].sort()).toEqual(['AMD|NVDA', 'AVGO|NVDA']);
  });
});

describe('profileDiffs', () => {
  const seed = (symbol: string) => {
    const found = COMPANIES.find((c) => c.symbol === symbol);
    if (!found) throw new Error(symbol);
    return found;
  };

  it('reports nothing when the profile matches the seed', () => {
    expect(profileDiffs(seed('NVDA'), recording('NVDA', []))).toEqual([]);
  });

  it('reports a different home listing, name and sector without changing anything', () => {
    const tsm = recording('TSM', [], {
      ticker: '2330.TW',
      name: 'Taiwan Semiconductor Manufacturing Co Ltd',
      finnhubIndustry: 'Semiconductors',
    });
    expect(profileDiffs({ ...seed('TSM'), primaryListing: 'TSM' }, tsm)).toEqual([
      'primaryListing: seed TSM, Finnhub 2330.TW',
    ]);
    expect(
      profileDiffs(
        seed('NVDA'),
        recording('NVDA', [], { name: 'Nvidia', finnhubIndustry: 'Media' }),
      ),
    ).toEqual([
      'name: seed "NVIDIA Corp", Finnhub "Nvidia"',
      'sector: seed semiconductors, Finnhub media',
    ]);
  });
});
