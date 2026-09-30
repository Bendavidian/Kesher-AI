import {
  DEMO_PASSWORD,
  DEMO_PERSONAS,
  DemoReplayResponse,
  HealthResponse,
  relevanceBand,
  SOCKET_EVENTS,
  type PersonaKey,
} from '@kesher/shared';
import { io, type Socket } from 'socket.io-client';
import { z } from 'zod';

// The deploy smoke test (SPEC.md decision log, T18): one pass over the deployed app as the demo
// uses it, through the same origin a browser uses. It changes only what the demo changes: the
// demo event's FeedItems, and with Investigate one research run from the day's budget.

export type CheckStatus = 'pass' | 'fail' | 'skip';
export interface CheckResult {
  name: string;
  status: CheckStatus;
  detail: string;
  ms: number;
}

export interface SmokeOptions {
  // Investigate spends one research run of the day's 30 on the free model tiers.
  investigate: boolean;
  // How long every persona may take to get event:scored after the demo replay.
  scoredTimeoutMs?: number;
  // How long the research run may take, queued behind others included.
  runTimeoutMs?: number;
  log?: (result: CheckResult) => void;
}

// The levels the demo shows (SPEC.md MVP definition of done, point 8).
export const EXPECTED_RELEVANCE: Record<PersonaKey, number> = { A: 0.8, B: 1, C: 0 };

const SHELL_MARKER = '<div id="root"></div>';
const SESSION_COOKIE = 'kesher_session';

// Only the fields the smoke reads; the api validates the rest.
const Card = z.object({
  item: z.object({
    eventId: z.string(),
    relevance: z.number(),
    research: z.object({
      state: z.string(),
      runId: z.string().nullable(),
      reportId: z.string().nullable(),
    }),
  }),
  priceReaction: z.unknown(),
});
type Card = z.infer<typeof Card>;
const Explain = z.object({ relevance: z.number() });
const Run = z.object({
  run: z.object({
    status: z.string(),
    tokensUsed: z.number(),
    steps: z.array(z.unknown()),
  }),
  reportId: z.string().nullable(),
});
const Scored = z.object({ eventId: z.string() });
const Ended = z.object({ runId: z.string(), status: z.string() });

class CheckFailed extends Error {}
const fail = (detail: string): never => {
  throw new CheckFailed(detail);
};

interface Persona {
  key: PersonaKey;
  cookie: string;
  socket: Socket;
  items: Card[];
  scored: Set<string>;
  ended: Map<string, string>;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(what: string, timeoutMs: number, done: () => boolean): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (!done()) {
    if (Date.now() > until) fail(`timed out after ${timeoutMs / 1000} s waiting for ${what}`);
    await sleep(100);
  }
}

export async function runSmoke(baseUrl: string, options: SmokeOptions): Promise<CheckResult[]> {
  const base = baseUrl.replace(/\/+$/, '');
  const { scoredTimeoutMs = 20_000, runTimeoutMs = 240_000, log = () => undefined } = options;
  const results: CheckResult[] = [];
  const personas = {} as Record<PersonaKey, Persona>;

  const check = async (name: string, body: () => Promise<string> | string): Promise<boolean> => {
    const started = Date.now();
    let result: CheckResult;
    try {
      result = { name, status: 'pass', detail: await body(), ms: Date.now() - started };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      result = { name, status: 'fail', detail, ms: Date.now() - started };
    }
    results.push(result);
    log(result);
    return result.status === 'pass';
  };
  const skip = (name: string, detail: string) => {
    const result: CheckResult = { name, status: 'skip', detail, ms: 0 };
    results.push(result);
    log(result);
  };
  const request = (path: string, init: RequestInit & { cookie?: string } = {}) => {
    const { cookie, ...rest } = init;
    return fetch(`${base}${path}`, {
      ...rest,
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(rest.body ? { 'content-type': 'application/json' } : {}),
      },
      redirect: 'manual',
    });
  };
  const json = async (response: Response, what: string): Promise<unknown> => {
    const text = await response.text();
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return fail(`${what} answered ${response.status} with a body that is not JSON`);
    }
  };
  const expectStatus = (response: Response, status: number, what: string) => {
    if (response.status !== status) fail(`${what} answered ${response.status}, not ${status}`);
  };
  const feedCard = async (persona: Persona, eventId: string): Promise<Card | undefined> => {
    const response = await request('/api/feed', { cookie: persona.cookie });
    expectStatus(response, 200, `GET /api/feed as ${persona.key}`);
    const cards = z.array(Card).parse(await json(response, 'GET /api/feed'));
    return cards.find((card) => card.item.eventId === eventId);
  };

  try {
    // A sleeping free instance wakes on this first request; its latency shows the cold start.
    await check('health', async () => {
      for (const path of ['/health', '/api/health']) {
        const response = await request(path);
        expectStatus(response, 200, `GET ${path}`);
        const health = HealthResponse.parse(await json(response, `GET ${path}`));
        if (!health.demoMode) fail(`GET ${path} says demo mode is off; set DEMO_MODE=true`);
      }
      return 'ok with demo mode on, at the root and under /api';
    });

    await check('web shell', async () => {
      for (const path of ['/', '/runs']) {
        const response = await request(path);
        expectStatus(response, 200, `GET ${path}`);
        if (!(await response.text()).includes(SHELL_MARKER))
          fail(`GET ${path} is not the app shell`);
      }
      return '/ and /runs serve index.html';
    });

    await check('routes closed', async () => {
      const dev = await request('/api/dev/replay/38062166', { method: 'POST' });
      expectStatus(dev, 404, 'POST /api/dev/replay');
      const demo = await request('/api/demo/replay', { method: 'POST' });
      expectStatus(demo, 401, 'POST /api/demo/replay without a session');
      for (const path of ['/mcp', '/api/mcp']) {
        const mcp = await request(path, { method: 'POST', body: '{}' });
        expectStatus(mcp, 401, `POST ${path} without a run token`);
      }
      return 'dev routes 404, demo replay 401 without a session, MCP 401 without a run token';
    });

    const signedIn = await check('sign in and sockets', async () => {
      for (const { key, email } of DEMO_PERSONAS) {
        const response = await request('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email, password: DEMO_PASSWORD }),
        });
        expectStatus(response, 200, `sign in as ${key}`);
        const pair = response.headers
          .getSetCookie()
          .map((header) => header.split(';')[0]!)
          .find((value) => value.startsWith(`${SESSION_COOKIE}=`));
        const cookie = pair ?? fail(`sign in as ${key} set no session cookie`);
        const persona: Persona = {
          key,
          cookie,
          socket: io(base, {
            transports: ['websocket'],
            extraHeaders: { cookie },
            reconnection: false,
            autoConnect: false,
          }),
          items: [],
          scored: new Set(),
          ended: new Map(),
        };
        persona.socket.on(SOCKET_EVENTS.feedItem, (card: unknown) => {
          const parsed = Card.safeParse(card);
          if (parsed.success) persona.items.push(parsed.data);
        });
        persona.socket.on(SOCKET_EVENTS.eventScored, (scored: unknown) => {
          const parsed = Scored.safeParse(scored);
          if (parsed.success) persona.scored.add(parsed.data.eventId);
        });
        persona.socket.on(SOCKET_EVENTS.runEnd, (ended: unknown) => {
          const parsed = Ended.safeParse(ended);
          if (parsed.success) persona.ended.set(parsed.data.runId, parsed.data.status);
        });
        personas[key] = persona;
        await new Promise<void>((resolve, reject) => {
          persona.socket.once('connect', resolve);
          persona.socket.once('connect_error', reject);
          persona.socket.connect();
        }).catch((error: unknown) =>
          fail(
            `the socket for ${key} did not connect: ${error instanceof Error ? error.message : 'error'}`,
          ),
        );
      }
      return 'A, B and C signed in, each with an open websocket';
    });
    if (!signedIn) return results;

    let eventId = '';
    const replayed = await check('demo replay', async () => {
      let response = await request('/api/demo/replay', {
        method: 'POST',
        cookie: personas.A.cookie,
      });
      if (response.status === 429) {
        const wait = Number(response.headers.get('retry-after') ?? '15');
        await sleep(wait * 1000);
        response = await request('/api/demo/replay', { method: 'POST', cookie: personas.A.cookie });
      }
      expectStatus(response, 200, 'POST /api/demo/replay');
      const body = DemoReplayResponse.parse(await json(response, 'POST /api/demo/replay'));
      if (body.replay.outcome !== 'processed') {
        fail(`the replay was ${body.replay.outcome}, not processed`);
      }
      eventId = body.replay.outcome === 'processed' ? body.replay.eventId : '';
      await waitFor('event:scored on every socket', scoredTimeoutMs, () =>
        Object.values(personas).every((p) => p.scored.has(eventId)),
      );
      return `processed, ${body.reset ? `${body.reset.deleted} FeedItems reset` : 'nothing to reset'}; every socket got event:scored`;
    });
    if (!replayed) return results;

    await check('live pushes', () => {
      const pushed = (key: PersonaKey) =>
        personas[key].items
          .filter((card) => card.item.eventId === eventId)
          .map((c) => c.item.relevance);
      if (pushed('A').join() !== '0.8') fail(`A got feed:item [${pushed('A').join()}], not [0.8]`);
      if (pushed('B').join() !== '1') fail(`B got feed:item [${pushed('B').join()}], not [1]`);
      if (pushed('C').length > 0) fail(`C got feed:item [${pushed('C').join()}], expected none`);
      return 'feed:item to A (0.8) and B (1), none to C';
    });

    let cardA: Card | undefined;
    await check('persona levels', async () => {
      cardA = await feedCard(personas.A, eventId);
      const cardB = await feedCard(personas.B, eventId);
      const cardC = await feedCard(personas.C, eventId);
      if (cardA?.item.relevance !== EXPECTED_RELEVANCE.A) {
        fail(`A's card has relevance ${cardA?.item.relevance ?? 'none'}, not 0.8`);
      }
      if (cardB?.item.relevance !== EXPECTED_RELEVANCE.B) {
        fail(`B's card has relevance ${cardB?.item.relevance ?? 'none'}, not 1`);
      }
      if (cardC) fail(`C's feed has the card, at relevance ${cardC.item.relevance}`);
      const explain = await request(`/api/events/${eventId}/explain`, {
        cookie: personas.C.cookie,
      });
      expectStatus(explain, 200, 'explain as C');
      const { relevance } = Explain.parse(await json(explain, 'explain'));
      if (relevance !== EXPECTED_RELEVANCE.C) fail(`explain for C gives ${relevance}, not 0`);
      const level = (key: PersonaKey, value: number) => {
        const band = relevanceBand(value);
        return `${key} ${band[0]!.toUpperCase()}${band.slice(1)} ${value.toFixed(2)}`;
      };
      return [
        level('A', EXPECTED_RELEVANCE.A),
        level('B', EXPECTED_RELEVANCE.B),
        level('C', relevance),
      ].join(', ');
    });

    await check('price reaction', () => {
      if (!cardA) fail("A's card is missing");
      if (cardA!.priceReaction === null) {
        fail("A's card has no price reaction: check the Alpaca keys on the host");
      }
      return "A's card carries the price reaction";
    });

    if (!options.investigate) {
      skip('investigate', 'skipped with --no-investigate');
      return results;
    }
    await check('investigate', async () => {
      const response = await request(`/api/events/${eventId}/investigate`, {
        method: 'POST',
        cookie: personas.A.cookie,
      });
      if (response.status === 429) {
        const { error } = z
          .object({ error: z.string() })
          .parse(await json(response, 'investigate'));
        fail(`the research budget is spent: ${error}`);
      }
      if (response.status === 409) fail('a research run on this card is already queued or running');
      expectStatus(response, 202, 'POST investigate');
      const card = Card.parse(await json(response, 'investigate'));
      const runId = card.item.research.runId ?? fail('the 202 card names no run');
      await waitFor('run:end', runTimeoutMs, () => personas.A.ended.has(runId));
      const status = personas.A.ended.get(runId);
      if (status !== 'succeeded') fail(`the run ended ${status}`);

      const runResponse = await request(`/api/runs/${runId}`, { cookie: personas.A.cookie });
      expectStatus(runResponse, 200, 'GET /api/runs/:runId');
      const { run, reportId } = Run.parse(await json(runResponse, 'GET /api/runs/:runId'));
      if (run.steps.length === 0) fail('the run has no steps');
      if (!reportId) fail('the run has no report');
      const report = await request(`/api/reports/${reportId}`, { cookie: personas.A.cookie });
      expectStatus(report, 200, 'GET /api/reports/:reportId');
      const screen = await request(`/runs/${runId}`);
      expectStatus(screen, 200, 'GET /runs/:runId');
      return `run ${runId} succeeded: ${run.steps.length} steps, ${run.tokensUsed} tokens, report ${reportId}`;
    });
    return results;
  } finally {
    for (const persona of Object.values(personas)) persona.socket.close();
  }
}

// A pass needs no failed check; a skipped Investigate is shown, not failed.
export const passed = (results: readonly CheckResult[]) =>
  results.length > 0 && results.every((result) => result.status !== 'fail');

export function formatResult({ name, status, detail, ms }: CheckResult): string {
  const mark = { pass: 'PASS', fail: 'FAIL', skip: 'SKIP' }[status];
  return `${mark}  ${name.padEnd(20)} ${(ms / 1000).toFixed(1).padStart(6)} s  ${detail}`;
}
