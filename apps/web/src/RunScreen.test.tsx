import type { AgentStep } from '@kesher/shared';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { AppRoutes } from './App';
import { DEMO_RUN, DEMO_TOKEN_SCOPE } from './fixtures/research';
import { runPath } from './routes';

afterEach(cleanup);

function renderRun(path = runPath(DEMO_RUN._id)) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
    </MemoryRouter>,
  );
}

function steps() {
  return within(screen.getByRole('list', { name: 'Run steps' })).getAllByRole('listitem');
}

function detail() {
  return screen.getByRole('region', { name: /^Step \d+ of \d+/ });
}

// The demo report lost a claim, so its check step is red.
const LINE_COLOR: Record<AgentStep['kind'], string> = {
  code: 'bg-code',
  tool: 'bg-supplier',
  model: 'bg-model',
  check: 'bg-down',
};

describe('Agent run screen', () => {
  it('opens from the Agent runs tab', () => {
    renderRun('/');
    fireEvent.click(screen.getByRole('link', { name: 'Agent runs' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Research run' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Agent runs' }).getAttribute('aria-current')).toBe(
      'page',
    );
  });

  it('shows tool calls, tokens against the budget, the model and a zero cost', () => {
    renderRun();
    const tiles = screen.getByRole('group', { name: 'Run summary' });
    expect(within(tiles).getByText('5 of 15')).toBeTruthy();
    expect(within(tiles).getByText('5.4k of 6k')).toBeTruthy();
    expect(within(tiles).getByText('gemini-3.5-flash-lite')).toBeTruthy();
    expect(within(tiles).getByText('$0.00')).toBeTruthy();
  });

  it('colors every timeline line by step kind', () => {
    renderRun();
    const items = steps();
    expect(items).toHaveLength(DEMO_RUN.steps.length);
    DEMO_RUN.steps.forEach((step, index) => {
      const line = within(items[index]!).getByTestId('step-line');
      expect(line.className).toContain(LINE_COLOR[step.kind]);
    });
  });

  it('shows duration on every step and tokens on model steps only', () => {
    renderRun();
    const items = steps();
    DEMO_RUN.steps.forEach((step, index) => {
      const text = items[index]!.textContent ?? '';
      expect(text).toMatch(/\d+(\.\d)? (ms|s)/);
      expect(/\d(\.\d)?k? tok\b/.test(text)).toBe(step.kind === 'model');
    });
  });

  it('selects a step and shows its input, output and kind', () => {
    renderRun();
    fireEvent.click(within(steps()[4]!).getByRole('button'));

    expect(steps()[4]!.getAttribute('aria-current')).toBe('step');
    const panel = detail();
    expect(within(panel).getByRole('heading', { level: 2, name: 'search_filings' })).toBeTruthy();
    expect(within(panel).getByText('Tool call')).toBeTruthy();
    expect(within(panel).getByText(/"foundry dependency"/)).toBeTruthy();
    expect(within(panel).getByText('Output, capped at 3 chunks')).toBeTruthy();
  });

  it('shows the provider and model of a model step', () => {
    renderRun(runPath(DEMO_RUN._id, 10));
    const panel = detail();
    expect(within(panel).getByRole('heading', { level: 2, name: 'Verifier agent' })).toBeTruthy();
    expect(within(panel).getByText('Groq, openai/gpt-oss-120b')).toBeTruthy();
    expect(within(panel).getByText(/1,920 tokens/)).toBeTruthy();
  });

  it('opens the step named in the address', () => {
    renderRun(runPath(DEMO_RUN._id, 9));
    expect(steps()[8]!.getAttribute('aria-current')).toBe('step');
    expect(
      within(detail()).getByRole('heading', { level: 2, name: 'Deterministic checks' }),
    ).toBeTruthy();
  });

  it('lists exactly the tools in the run token scope', () => {
    renderRun(runPath(DEMO_RUN._id, 5));
    const access = screen.getByRole('region', { name: /^Access for this/ });
    const tools = within(within(access).getByRole('list', { name: 'Allowed tools' }))
      .getAllByRole('listitem')
      .map((item) => item.textContent);
    expect(tools).toEqual(DEMO_TOKEN_SCOPE.tools);
    expect(within(access).getByText(/Taken from your sign in/)).toBeTruthy();
    expect(within(access).getByText(/read only/)).toBeTruthy();
  });

  it('shows the provider limits and the run token budget in the footer', () => {
    renderRun();
    const footer = screen.getByRole('contentinfo', { name: 'Run limits' });
    expect(within(footer).getByText('Token budget per run: 6,000')).toBeTruthy();
    expect(within(footer).getByText(/Groq free tier/)).toBeTruthy();
  });
});
