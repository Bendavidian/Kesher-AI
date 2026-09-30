import type { AgentRun, AgentStep, RunDetail, RunSummary } from '@kesher/shared';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './api/client';
import { AppRoutes } from './App';
import { PUBLIC_USERS } from './fixtures';
import {
  DEMO_FAILED_RUN,
  DEMO_FAILED_RUN_DETAIL,
  DEMO_RUN,
  DEMO_RUN_DETAIL,
  DEMO_RUN_SUMMARIES,
  DEMO_TOOLS,
} from './fixtures/research';
import { LiveDepsContext, type LiveDeps } from './live/deps';
import type { FeedSocketHandlers } from './live/socket';
import { AGENT_RUNS_PATH, runPath } from './routes';

afterEach(cleanup);

// The api as the run screen uses it: GET /runs/:runId, GET /runs and GET /me for persona A, and a
// socket whose pushes each test sends by hand.
function fakeDeps({
  runs = [DEMO_RUN_DETAIL, DEMO_FAILED_RUN_DETAIL],
  list = DEMO_RUN_SUMMARIES,
}: { runs?: RunDetail[]; list?: RunSummary[] } = {}) {
  const sockets: { handlers: FeedSocketHandlers; closed: boolean }[] = [];
  const api = {
    signInAs: vi.fn(() => Promise.resolve(PUBLIC_USERS.A)),
    me: vi.fn(() => Promise.resolve(PUBLIC_USERS.A)),
    createGuest: vi.fn(() => Promise.reject(new Error('not used'))),
    changeGuestPortfolio: vi.fn(() => Promise.reject(new Error('not used'))),
    feed: vi.fn(() => Promise.resolve([])),
    explain: vi.fn(() => Promise.reject(new Error('not used'))),
    investigate: vi.fn(() => Promise.reject(new Error('not used'))),
    report: vi.fn(() => Promise.reject(new Error('not used'))),
    run: vi.fn((runId: string) => {
      const detail = runs.find((d) => d.run._id === runId);
      return detail
        ? Promise.resolve(detail)
        : Promise.reject(new ApiError('no run with that id', 404));
    }),
    runs: vi.fn(() => Promise.resolve(list)),
    replayDemo: vi.fn(() => Promise.reject(new Error('not used'))),
  };
  const deps: LiveDeps = {
    api,
    connectFeed: (handlers) => {
      const socket = { handlers, closed: false };
      sockets.push(socket);
      return { close: () => (socket.closed = true) };
    },
  };
  const socket = () => sockets.filter((s) => !s.closed).at(-1)!.handlers;
  return { api, deps, socket };
}

function renderAt(path: string, deps = fakeDeps().deps) {
  render(
    <LiveDepsContext value={deps}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </LiveDepsContext>,
  );
}

async function renderRun(path = runPath(DEMO_RUN._id), deps = fakeDeps().deps) {
  renderAt(path, deps);
  await screen.findByRole('heading', { level: 1, name: 'Research run' });
}

function steps() {
  return within(screen.getByRole('list', { name: 'Run steps' })).getAllByRole('listitem');
}

function detail() {
  return screen.getByRole('region', { name: /^Step \d+ of \d+/ });
}

// The demo check step lists a removed claim, so it is red.
const LINE_COLOR: Record<AgentStep['kind'], string> = {
  code: 'bg-code',
  tool: 'bg-supplier',
  model: 'bg-model',
  check: 'bg-down',
};

const at = new Date('2026-09-29T12:00:00Z');
const step = (name: string, output: string, outputTruncated = false): AgentStep => ({
  kind: 'tool',
  name,
  input: { query: 'TSMC' },
  outputSummary: `${name} ran.`,
  output,
  outputTruncated,
  latencyMs: 20,
  startedAt: at,
});
const withSteps = (run: AgentRun, extra: AgentStep[]): RunDetail => ({
  ...DEMO_RUN_DETAIL,
  run: { ...run, steps: [...run.steps, ...extra] },
});

describe('Agent run screen', () => {
  it('opens the newest run from the Agent runs tab', async () => {
    const { api, deps } = fakeDeps();
    renderAt(AGENT_RUNS_PATH, deps);
    await screen.findByRole('heading', { level: 1, name: 'Research run' });
    expect(api.run).toHaveBeenCalledWith(DEMO_RUN_SUMMARIES[0]!._id);
    const tab = screen.getByRole('link', { name: 'Agent runs' });
    expect(tab.getAttribute('href')).toBe('/runs');
    expect(tab.getAttribute('aria-current')).toBe('page');
  });

  it('says there is no run yet when the user has none', async () => {
    renderAt(AGENT_RUNS_PATH, fakeDeps({ list: [] }).deps);
    expect(await screen.findByRole('heading', { name: 'No agent runs yet' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Back to your feed' })).toBeTruthy();
  });

  it('reads the run from the api and shows whose it is', async () => {
    const { api, deps } = fakeDeps();
    await renderRun(runPath(DEMO_RUN._id), deps);
    expect(api.run).toHaveBeenCalledWith(DEMO_RUN._id);
    expect(screen.getByText('AI investor')).toBeTruthy();
    expect(screen.getByText(/Investigate on the TSMC event/)).toBeTruthy();
  });

  it('shows tool calls, tokens against the budget, the model and a zero cost', async () => {
    await renderRun();
    const tiles = screen.getByRole('group', { name: 'Run summary' });
    expect(within(tiles).getByText('5 of 15')).toBeTruthy();
    expect(within(tiles).getByText('3.5k of 20k')).toBeTruthy();
    expect(within(tiles).getByText('Verifier 1.9k of 6k')).toBeTruthy();
    expect(within(tiles).getByText('gemini-3.5-flash-lite')).toBeTruthy();
    expect(within(tiles).getByText('$0.00')).toBeTruthy();
  });

  it('colors every timeline line by step kind, red for the check that removed a claim', async () => {
    await renderRun();
    const items = steps();
    expect(items).toHaveLength(DEMO_RUN.steps.length);
    DEMO_RUN.steps.forEach((step, index) => {
      const line = within(items[index]!).getByTestId('step-line');
      expect(line.className).toContain(LINE_COLOR[step.kind]);
    });
  });

  it('shows duration on every step and tokens on model steps only', async () => {
    await renderRun();
    const items = steps();
    DEMO_RUN.steps.forEach((step, index) => {
      const text = items[index]!.textContent ?? '';
      expect(text).toMatch(/\d+(\.\d)? (ms|s)/);
      expect(/\d(\.\d)?k? tok\b/.test(text)).toBe(step.kind === 'model');
    });
  });

  it('selects a step and shows its input and stored output', async () => {
    await renderRun();
    fireEvent.click(within(steps()[4]!).getByRole('button'));

    expect(steps()[4]!.getAttribute('aria-current')).toBe('step');
    const panel = detail();
    expect(within(panel).getByRole('heading', { level: 2, name: 'search_filings' })).toBeTruthy();
    expect(within(panel).getByText('Tool call')).toBeTruthy();
    expect(within(panel).getByText(/"foundry dependency"/)).toBeTruthy();
    const output = within(panel).getByLabelText('Step output');
    expect(output.textContent).toContain('"fc_nvda_10k_item1_014"');
    expect(within(panel).getByText('Three passages from the NVIDIA 10-K.')).toBeTruthy();
  });

  it('shows the provider and model of a model step', async () => {
    await renderRun(runPath(DEMO_RUN._id, 10));
    const panel = detail();
    expect(within(panel).getByRole('heading', { level: 2, name: 'Verifier' })).toBeTruthy();
    expect(within(panel).getByText('Groq, openai/gpt-oss-120b')).toBeTruthy();
    expect(within(panel).getByText(/1,920 tokens/)).toBeTruthy();
  });

  it('opens the step named in the address', async () => {
    await renderRun(runPath(DEMO_RUN._id, 9));
    expect(steps()[8]!.getAttribute('aria-current')).toBe('step');
    expect(
      within(detail()).getByRole('heading', { level: 2, name: 'Deterministic checks' }),
    ).toBeTruthy();
  });

  it('lists exactly the tools the run token was issued with', async () => {
    await renderRun(runPath(DEMO_RUN._id, 5));
    const access = screen.getByRole('region', { name: /^Access for this/ });
    const tools = within(within(access).getByRole('list', { name: 'Allowed tools' }))
      .getAllByRole('listitem')
      .map((item) => item.textContent);
    expect(tools).toEqual(DEMO_TOOLS);
    expect(within(access).getByText(/Taken from your sign in/)).toBeTruthy();
    expect(within(access).getByText(/read only/)).toBeTruthy();
    expect(within(access).getByText('5 minutes after the run starts.')).toBeTruthy();
  });

  it('shows the limits the api serves and the run token budget in the footer', async () => {
    await renderRun();
    const footer = screen.getByRole('contentinfo', { name: 'Run limits' });
    expect(
      within(footer).getByText('Token budget per run: 20,000 for research, 6,000 for the verifier'),
    ).toBeTruthy();
    expect(
      within(footer).getByText('Groq free tier: 8,000 tokens per minute, 1,000 requests per day'),
    ).toBeTruthy();
  });

  it('renders step output as text, never as HTML', async () => {
    const markup = '<img src="x" onerror="alert(1)"><b>bold</b><script>alert(2)</script>';
    const run = withSteps(DEMO_RUN, [
      step('search_news', markup),
      step('get_event', JSON.stringify({ headline: markup })),
    ]);
    const count = run.run.steps.length;
    await renderRun(runPath(DEMO_RUN._id, count - 1), fakeDeps({ runs: [run] }).deps);

    let output = within(detail()).getByLabelText('Step output');
    expect(output.textContent).toBe(markup);
    expect(output.querySelector('img, b, script')).toBeNull();

    fireEvent.click(within(steps()[count - 1]!).getByRole('button'));
    output = within(detail()).getByLabelText('Step output');
    expect(output.textContent).toContain(JSON.stringify(markup));
    expect(output.querySelector('img, b, script')).toBeNull();
    expect(document.querySelector('img[src="x"], script:not([src])')).toBeNull();
  });

  it('says when the 8 KB cap cut a step output, and shows the kept text as is', async () => {
    const cut = '{"items":[{"headline":"TSMC halts';
    const run = withSteps(DEMO_RUN, [step('search_news', cut, true)]);
    await renderRun(runPath(DEMO_RUN._id, run.run.steps.length), fakeDeps({ runs: [run] }).deps);
    const panel = detail();
    expect(within(panel).getByText('Output, capped at 8 KB')).toBeTruthy();
    expect(within(panel).getByLabelText('Step output').textContent).toBe(cut);
  });

  it('names why a failed run ended, with no report link', async () => {
    await renderRun(runPath(DEMO_FAILED_RUN._id));
    expect(screen.getByText('Failed')).toBeTruthy();
    expect(screen.getByText(/kept asking to wait, so the run ended without a report/)).toBeTruthy();
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(crumbs).getByRole('link', { name: 'Feed' })).toBeTruthy();
    expect(within(crumbs).queryByRole('link', { name: 'Research report' })).toBeNull();
  });
});

describe('Recent runs selector', () => {
  it('lists the user runs with time, mode and status, and switches between them', async () => {
    const { api, deps } = fakeDeps();
    await renderRun(runPath(DEMO_RUN._id), deps);
    const toggle = screen.getByRole('button', { name: /Recent runs/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');

    const rows = within(screen.getByRole('list', { name: 'Recent runs' })).getAllByRole('link');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toMatch(/Sep 28, \d{2}:\d{2} ET/);
    expect(rows[0]!.textContent).toContain('TSMC, deep mode');
    expect(rows[0]!.textContent).toContain('Failed');
    expect(rows[1]!.textContent).toContain('Completed');
    expect(rows[1]!.getAttribute('aria-current')).toBe('page');

    fireEvent.click(rows[0]!);
    await screen.findByText(/kept asking to wait/);
    expect(api.run).toHaveBeenLastCalledWith(DEMO_FAILED_RUN._id);
    expect(screen.queryByRole('list', { name: 'Recent runs' })).toBeNull();
  });

  it('closes on Escape', async () => {
    await renderRun();
    fireEvent.click(screen.getByRole('button', { name: /Recent runs/ }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('list', { name: 'Recent runs' })).toBeNull();
  });
});

describe('Agent run screen, live', () => {
  const running: RunDetail = {
    ...DEMO_RUN_DETAIL,
    reportId: null,
    claims: [],
    run: {
      ...DEMO_RUN,
      steps: DEMO_RUN.steps.slice(0, 2),
      tokensUsed: 0,
      status: 'running',
      finishedAt: null,
    },
  };

  it('adds each pushed step of this run once, in order', async () => {
    const { deps, socket } = fakeDeps({ runs: [running] });
    await renderRun(runPath(DEMO_RUN._id), deps);
    expect(steps()).toHaveLength(2);

    act(() => socket().onRunStep!({ runId: DEMO_RUN._id, index: 2, step: DEMO_RUN.steps[2]! }));
    expect(steps()).toHaveLength(3);
    expect(steps()[2]!.textContent).toContain('get_event');

    // A step already shown, and a step of another run, change nothing.
    act(() => socket().onRunStep!({ runId: DEMO_RUN._id, index: 2, step: DEMO_RUN.steps[2]! }));
    act(() =>
      socket().onRunStep!({ runId: DEMO_FAILED_RUN._id, index: 3, step: DEMO_RUN.steps[3]! }),
    );
    expect(steps()).toHaveLength(3);
  });

  it('reads the run again after a missed step and when the run ends', async () => {
    const { api, deps, socket } = fakeDeps({ runs: [running] });
    await renderRun(runPath(DEMO_RUN._id), deps);
    expect(api.run).toHaveBeenCalledTimes(1);

    act(() => socket().onRunStep!({ runId: DEMO_RUN._id, index: 5, step: DEMO_RUN.steps[5]! }));
    await vi.waitFor(() => expect(api.run).toHaveBeenCalledTimes(2));

    act(() => socket().onRunEnd!({ runId: DEMO_FAILED_RUN._id, status: 'failed' }));
    act(() => socket().onRunEnd!({ runId: DEMO_RUN._id, status: 'succeeded' }));
    await vi.waitFor(() => expect(api.run).toHaveBeenCalledTimes(3));
  });

  it('shows a run that was not stored yet once its first step arrives', async () => {
    const runs: RunDetail[] = [];
    const { deps, socket } = fakeDeps({ runs });
    renderAt(runPath(DEMO_RUN._id), deps);
    expect(await screen.findByRole('heading', { name: 'No agent run here' })).toBeTruthy();

    runs.push(running);
    act(() => socket().onRunStep!({ runId: DEMO_RUN._id, index: 0, step: DEMO_RUN.steps[0]! }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Research run' })).toBeTruthy();
    expect(steps()).toHaveLength(2);
  });
});
