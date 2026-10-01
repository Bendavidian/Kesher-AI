import { z } from 'zod';

// Demo universe, SPEC.md "Demo universe and personas".
export const UNIVERSE = [
  // AI and cloud
  'NVDA',
  'MSFT',
  'AMZN',
  'GOOGL',
  'META',
  // Semiconductors
  'AMD',
  'AVGO',
  'INTC',
  'QCOM',
  'MU',
  // Manufacturing and equipment
  'TSM',
  'ASML',
  'AMAT',
  'LRCX',
  // Unrelated
  'KO',
  'JNJ',
  'XOM',
] as const;
export const UniverseSymbol = z.enum(UNIVERSE);
export type UniverseSymbol = z.infer<typeof UniverseSymbol>;

// The same universe by sector, in SPEC.md order, for the guest portfolio picker (T24).
export const UNIVERSE_SECTORS = [
  { label: 'AI and cloud', symbols: ['NVDA', 'MSFT', 'AMZN', 'GOOGL', 'META'] },
  { label: 'Semiconductors', symbols: ['AMD', 'AVGO', 'INTC', 'QCOM', 'MU'] },
  { label: 'Manufacturing and equipment', symbols: ['TSM', 'ASML', 'AMAT', 'LRCX'] },
  { label: 'Unrelated', symbols: ['KO', 'JNJ', 'XOM'] },
] as const satisfies readonly { label: string; symbols: readonly UniverseSymbol[] }[];

// Benchmarks are price only and never universe companies: an item tagged only with them
// does not pass the pre filter.
export const BENCHMARKS = ['SPY', 'SMH'] as const;
export const Benchmark = z.enum(BENCHMARKS);
export type Benchmark = z.infer<typeof Benchmark>;
