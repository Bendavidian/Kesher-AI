import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DEMO_PRICE_REACTION } from '../fixtures/demoEvent';
import { MarketTable } from './MarketTable';
import { TickerFooter } from './TickerFooter';

// The anchored price moves from docs/SPIKE.md, as fixtures. The live feed shows the api's
// price reaction (FeedCard.priceReaction) through the same components.

afterEach(cleanup);

describe('MarketTable', () => {
  it('marks the held symbol', () => {
    render(<MarketTable reaction={DEMO_PRICE_REACTION} held={['NVDA']} />);
    const table = screen.getByRole('table');
    expect(within(table).getByRole('rowheader', { name: 'NVDA, you hold' })).toBeTruthy();
    expect(within(table).getByRole('rowheader', { name: 'TSM' })).toBeTruthy();
  });

  it('shows signed percentages with a true minus', () => {
    render(<MarketTable reaction={DEMO_PRICE_REACTION} held={['TSM']} />);
    const table = screen.getByRole('table');
    expect(within(table).getAllByText('−1.16%').length).toBeGreaterThan(0);
    expect(within(table).getAllByText('+1.25%').length).toBeGreaterThan(0);
    expect(table.textContent).not.toMatch(/-\d/);
  });

  it('shows a dash, never a number, for a window that is not ready yet', () => {
    const pending = {
      ...DEMO_PRICE_REACTION,
      rows: DEMO_PRICE_REACTION.rows.map((row) => ({
        ...row,
        moves: [row.moves[0] ?? null, null, null, null],
      })),
    };
    render(<MarketTable reaction={pending} held={['NVDA']} />);
    const table = screen.getByRole('table');
    expect(within(table).getAllByText('—')).toHaveLength(12);
    expect(within(table).getAllByText('not available yet')).toHaveLength(12);
    expect(within(table).getByText('−1.16%')).toBeTruthy();
  });
});

describe('TickerFooter', () => {
  it('shows the closing moves with a true minus', () => {
    render(<TickerFooter reaction={DEMO_PRICE_REACTION} apiStatus="ok" />);
    const footer = screen.getByRole('contentinfo');
    expect(within(footer).getByText('−0.54%')).toBeTruthy();
    expect(footer.textContent).not.toMatch(/-\d/);
  });
});
