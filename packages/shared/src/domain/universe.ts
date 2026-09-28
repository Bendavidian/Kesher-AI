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

// Benchmarks are price only and never universe companies: an item tagged only with them
// does not pass the pre filter.
export const BENCHMARKS = ['SPY', 'SMH'] as const;
export const Benchmark = z.enum(BENCHMARKS);
export type Benchmark = z.infer<typeof Benchmark>;
