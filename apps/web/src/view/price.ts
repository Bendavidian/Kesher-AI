import type { PriceReaction as ApiPriceReaction, PriceWindowName } from '@kesher/shared';
import type { PriceReaction } from './types';

// Column labels per window. After a headline in a session the windows count from the headline;
// otherwise from the next open (SPEC.md, Price reaction).
const WINDOW_LABEL: Record<ApiPriceReaction['anchor']['kind'], Record<PriceWindowName, string>> = {
  previous_close: {
    open_gap: 'Open gap',
    '15m': '15 min after open',
    '2h': '2 h after open',
    session_close: 'Session close',
  },
  headline: {
    open_gap: 'Open gap',
    '15m': '15 min after headline',
    '2h': '2 h after headline',
    session_close: 'Session close',
  },
};

export const DELAY_NOTE = 'SIP data, delayed 15 minutes';

// The api's price reaction as the market table, open gap bars and ticker footer show it. Every
// number is the api's; a window that is not ready yet stays null.
export function priceReactionView(reaction: ApiPriceReaction): PriceReaction {
  return {
    anchor: {
      kind: reaction.anchor.kind,
      baseAt: reaction.anchor.baseTime,
      // A calendar day; noon UTC keeps it on the same day in ET.
      tradingDay: new Date(`${reaction.anchor.tradingDay}T12:00:00Z`),
    },
    windows: reaction.windows.map((window) => WINDOW_LABEL[reaction.anchor.kind][window.name]),
    rows: reaction.rows.map((row) => ({
      symbol: row.symbol,
      moves: row.moves.map((move) => move.pct),
    })),
    delayNote: DELAY_NOTE,
  };
}
