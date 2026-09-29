import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DEMO_PRICE_REACTION } from '../fixtures/demoEvent';
import { MarketTable } from './MarketTable';
import { TickerFooter } from './TickerFooter';

// The anchored price moves from docs/SPIKE.md. The live feed shows them once the api sends a
// price reaction (T13); until then they are fixtures for these tests.

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
});

describe('TickerFooter', () => {
  it('shows the closing moves with a true minus', () => {
    render(<TickerFooter reaction={DEMO_PRICE_REACTION} apiStatus="ok" />);
    const footer = screen.getByRole('contentinfo');
    expect(within(footer).getByText('−0.54%')).toBeTruthy();
    expect(footer.textContent).not.toMatch(/-\d/);
  });
});
