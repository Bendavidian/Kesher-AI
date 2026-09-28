import type { Claim } from '@kesher/shared';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { AppRoutes } from './App';
import { DEMO_CLAIMS, DEMO_REPORT, DEMO_REPORT_SOURCES, DEMO_RUN } from './fixtures/research';
import { reportPath } from './routes';
import { buildReportView } from './view/report';

afterEach(cleanup);

function renderReport() {
  render(
    <MemoryRouter initialEntries={[reportPath(DEMO_REPORT._id)]}>
      <AppRoutes />
    </MemoryRouter>,
  );
}

function rows() {
  return within(screen.getByRole('list', { name: 'Claims' })).getAllByRole('listitem');
}

const CHIP_COLOR: Record<Claim['type'], string[]> = {
  fact: ['bg-supplier-tint', 'text-supplier'],
  metric: ['bg-code-tint', 'text-code'],
  inference: ['bg-model-tint', 'text-model'],
};

const shown = DEMO_CLAIMS.filter((claim) => claim.status !== 'removed');
const removed = DEMO_CLAIMS.filter((claim) => claim.status === 'removed');

describe('Research report screen', () => {
  it('lists the shown claims in order with a type chip in the right color', () => {
    renderReport();
    const items = rows();
    expect(items).toHaveLength(shown.length);
    shown.forEach((claim, index) => {
      const chip = within(items[index]!).getByTestId('claim-type');
      expect(chip.textContent).toBe(
        { fact: 'Fact', metric: 'Metric', inference: 'Inference' }[claim.type],
      );
      for (const color of CHIP_COLOR[claim.type]) expect(chip.className).toContain(color);
      expect(items[index]!.textContent).toContain(claim.text);
    });
  });

  it('uses the same chip colors in the legend', () => {
    renderReport();
    const legend = screen.getByRole('list', { name: 'Claim types' });
    for (const [type, colors] of Object.entries(CHIP_COLOR)) {
      const label = { fact: 'Fact', metric: 'Metric', inference: 'Inference' }[type]!;
      const chip = within(legend).getByText(label);
      for (const color of colors) expect(chip.className).toContain(color);
    }
  });

  it('draws one green segment per supported claim and one red per removed claim', () => {
    renderReport();
    const bar = screen.getByRole('img', { name: '4 claims supported, 1 removed' });
    const segments = Array.from(bar.children);
    const statuses = DEMO_CLAIMS.map((claim) => claim.status);
    expect(segments).toHaveLength(statuses.length);
    const green = segments.filter((s) => s.className.includes('bg-up'));
    const red = segments.filter((s) => s.className.includes('bg-down'));
    expect(green).toHaveLength(statuses.filter((s) => s === 'supported').length);
    expect(red).toHaveLength(statuses.filter((s) => s === 'removed').length);
    // Green first, red last.
    expect(segments.at(-1)!.className).toContain('bg-down');
  });

  it('keeps the bar in step with the claim statuses', () => {
    const allSupported = DEMO_CLAIMS.map((claim) => ({ ...claim, status: 'supported' as const }));
    const view = buildReportView(DEMO_REPORT, allSupported, DEMO_RUN, DEMO_REPORT_SOURCES);
    expect(view.bar).toEqual(Array(DEMO_CLAIMS.length).fill('supported'));
    expect(view.barLabel).toBe('5 claims supported, 0 removed');
  });

  it('shows the chips for mode, tool calls, supported and removed', () => {
    renderReport();
    const chips = screen.getByRole('list', { name: 'Report summary' });
    for (const text of ['Deep mode', '5 of 15 tool calls', '4 supported', '1 removed']) {
      expect(within(chips).getByText(text)).toBeTruthy();
    }
  });

  it('never renders the text or quote of a removed claim', () => {
    renderReport();
    const page = document.body.textContent ?? '';
    for (const claim of removed) {
      expect(page).not.toContain(claim.text);
      for (const source of claim.sources) {
        if (source.quote) expect(page).not.toContain(source.quote);
      }
    }
    const block = screen.getByRole('region', { name: '1 claim removed by verification' });
    expect(within(block).getByText(/quote wasn't found in the cited source/)).toBeTruthy();
  });

  it('links the removed block to the check in the agent run', () => {
    renderReport();
    const block = screen.getByRole('region', { name: '1 claim removed by verification' });
    fireEvent.click(within(block).getByRole('link', { name: 'See the check in the agent run' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Research run' })).toBeTruthy();
    const current = within(screen.getByRole('list', { name: 'Run steps' }))
      .getAllByRole('listitem')
      .findIndex((item) => item.getAttribute('aria-current') === 'step');
    expect(DEMO_RUN.steps[current]?.kind).toBe('check');
  });

  it('builds the inference and metric evidence lines from templates', () => {
    renderReport();
    const items = rows();
    expect(items[2]!.textContent).toContain(
      'Built on claims 1 and 2. Shown as a possibility, not as a fact.',
    );
    expect(items[3]!.textContent).toContain("Timing only, the report doesn't claim a cause.");
  });

  it('lists only the sources the shown claims cite, numbered by first citation', () => {
    renderReport();
    const list = screen.getByRole('list', { name: 'Sources' });
    const titles = within(list)
      .getAllByRole('listitem')
      .map((item) => item.textContent);
    expect(titles).toHaveLength(3);
    expect(titles[0]).toContain('[1]');
    expect(titles[0]).toContain('Benzinga via Alpaca');
    expect(titles[1]).toContain('Tier 1 primary');
    expect(titles[2]).toContain('Market data');
  });

  it('shows the connection to the investor from the graph path', () => {
    renderReport();
    const side = screen.getByRole('complementary', { name: 'Connection and sources' });
    expect(within(side).getByText('High 0.80')).toBeTruthy();
    expect(within(side).getByRole('img', { name: /TSMC supplies NVIDIA/ })).toBeTruthy();
  });

  it('opens from the run breadcrumb and links back to the run', () => {
    render(
      <MemoryRouter initialEntries={[`/runs/${DEMO_RUN._id}`]}>
        <AppRoutes />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('link', { name: 'Research report' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Research report' })).toBeTruthy();
    fireEvent.click(screen.getByRole('link', { name: 'View agent run' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Research run' })).toBeTruthy();
  });
});
