import { Source } from './domain/source';
import { etDate, type PriceAnchor, type PriceReaction } from './price';

// The Source a price reaction is cited by (SPEC.md decision log, T13): kind market_data from
// provider alpaca, one per set of symbols and anchor, so a metric claim about the moves cites a
// stored source like any other claim. Built by code from the computed reaction; nothing here
// comes from a model. Pure and browser safe; the api writes it with upsertPriceReactionSource.

const PREFIX = 'price_reaction';

// "price_reaction:TSM,SMH,SPY:previous_close:2024-04-02T20:00:00.000Z". The rows fix the symbols
// and the anchor fixes the windows, so equal inputs name the same source.
export function priceReactionExternalId(reaction: PriceReaction): string {
  const symbols = reaction.rows.map((row) => row.symbol).join(',');
  return `${PREFIX}:${symbols}:${reaction.anchor.kind}:${reaction.anchor.baseTime.toISOString()}`;
}

export interface PriceReactionRef {
  symbols: string[];
  kind: PriceAnchor['kind'];
  baseTime: Date;
}

// The parts of an external id built above, or null for any other id.
export function parsePriceReactionExternalId(externalId: string): PriceReactionRef | null {
  const [prefix, symbols, kind, ...time] = externalId.split(':');
  const baseTime = new Date(time.join(':'));
  if (prefix !== PREFIX || !symbols || Number.isNaN(baseTime.getTime())) return null;
  if (kind !== 'headline' && kind !== 'previous_close') return null;
  return { symbols: symbols.split(','), kind, baseTime };
}

export function anchorNote(kind: PriceAnchor['kind'], baseTime: Date): string {
  const day = etDate(baseTime);
  return kind === 'previous_close'
    ? `anchored to the previous regular close on ${day}`
    : `anchored to the price at the headline on ${day}`;
}

const listed = (symbols: readonly string[]) =>
  symbols.length < 2
    ? symbols.join('')
    : `${symbols.slice(0, -1).join(', ')} and ${symbols[symbols.length - 1]}`;

const percent = (pct: number | null) =>
  pct === null ? 'not available yet' : `${pct > 0 ? '+' : ''}${pct.toFixed(2)}%`;

// The moves as text, the way a claim can quote them. Timing only, never a cause.
export function priceReactionText(reaction: PriceReaction): string {
  const { anchor, windows, rows } = reaction;
  const lines = [
    `SIP minute bars, delayed 15 minutes, ${anchorNote(anchor.kind, anchor.baseTime)} (trading day ${anchor.tradingDay}). Moves show timing only, never a cause.`,
    ...rows.map((row) => {
      const base = row.basePrice === null ? 'no base price' : `base ${row.basePrice.toFixed(2)}`;
      const moves = row.moves.map((move, i) => `${windows[i]?.name} ${percent(move.pct)}`);
      return `${row.symbol}: ${base}; ${moves.join(', ')}`;
    }),
  ];
  return lines.join('\n');
}

export function priceReactionSource(reaction: PriceReaction, id: string, now: Date): Source {
  const symbols = reaction.rows.map((row) => row.symbol);
  const start = reaction.anchor.baseTime.toISOString();
  return Source.parse({
    _id: id,
    provider: 'alpaca',
    kind: 'market_data',
    tier: 1,
    externalId: priceReactionExternalId(reaction),
    // The Alpaca request the bars come from, without keys.
    url: `https://data.alpaca.markets/v2/stocks/bars?symbols=${symbols.join(',')}&timeframe=1Min&start=${start}&feed=sip`,
    author: null,
    publisher: null,
    title: `SIP bars for ${listed(symbols)}`,
    text: priceReactionText(reaction),
    symbols,
    publishedAt: reaction.anchor.baseTime,
    // Computed by code from exchange data; there is nothing to screen.
    injectionScreen: null,
    createdAt: now,
  });
}
