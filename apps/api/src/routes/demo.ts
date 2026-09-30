import { DEMO_SOURCE_ID, DemoReplayResponse } from '@kesher/shared';
import { Router } from 'express';
import type { Db } from 'mongodb';
import { requireUser } from '../auth/session';
import { describeTarget, replayItem, resetItem, type ReplayDeps } from '../ingest/replay';
import { sendReplayOutcome } from './dev';

// The pause after a demo replay ends before the next may start, so a public visitor cannot
// replay in a loop. Once the demo item is extracted, a replay calls no model (on a fresh database
// the first one runs the screen and the extraction); the cooldown still bounds the reset, the
// scoring, the pushes and the gate's skipped runs. Automatic research does not restart: the
// gate's recent check reads agent_runs, which a reset leaves alone, so within 24 hours of a run
// it attaches that run's report with no model call.
export const DEMO_COOLDOWN_MS = 15_000;

export type DemoStart =
  | { ok: true; done: () => void }
  | { ok: false; status: 409 }
  | { ok: false; status: 429; retryAfterSeconds: number };

// One demo replay at a time, then the cooldown, counted from the end of the last one whatever
// its result. In process: the deployed api is one instance.
export function createDemoLimiter({
  cooldownMs = DEMO_COOLDOWN_MS,
  now = Date.now,
}: { cooldownMs?: number; now?: () => number } = {}) {
  let running = false;
  let endedAt: number | undefined;
  return {
    tryStart(): DemoStart {
      if (running) return { ok: false, status: 409 };
      const wait = endedAt === undefined ? 0 : endedAt + cooldownMs - now();
      if (wait > 0) return { ok: false, status: 429, retryAfterSeconds: Math.ceil(wait / 1000) };
      running = true;
      let finished = false;
      return {
        ok: true,
        done: () => {
          if (finished) return;
          finished = true;
          running = false;
          endedAt = now();
        },
      };
    },
  };
}

export interface DemoOptions {
  cooldownMs?: number;
  now?: () => number;
}

const DEMO_TARGET = { provider: 'alpaca', externalId: DEMO_SOURCE_ID } as const;

// POST /demo/replay, mounted only in demo mode (SPEC.md decision log, T18): for a signed in user,
// the reset, then the replay, of the pinned demo item, as the web's Replay control did through
// the development routes. It takes no id, so no other item can be replayed through it. The reset
// deletes the event's FeedItems for every user, so every open session sees the card arrive.
export function demoRouter(
  db: Db,
  secret: string,
  replay: ReplayDeps,
  options: DemoOptions = {},
): Router {
  const router = Router();
  const limiter = createDemoLimiter(options);

  router.post('/demo/replay', requireUser(secret), async (_req, res) => {
    const start = limiter.tryStart();
    if (!start.ok) {
      if (start.status === 409) {
        res.status(409).json({ error: 'a demo replay is already running' });
        return;
      }
      res.set('Retry-After', String(start.retryAfterSeconds));
      res.status(429).json({
        error: `the demo was just replayed; replay again in ${start.retryAfterSeconds} s`,
      });
      return;
    }
    try {
      const reset = await resetItem(db, DEMO_TARGET);
      const outcome = await replayItem(db, DEMO_TARGET, replay);
      if (outcome.kind === 'no_recording') {
        res.status(404).json({ error: `no recording for ${describeTarget(DEMO_TARGET)}` });
        return;
      }
      if (outcome.kind === 'replayed') {
        res.json(DemoReplayResponse.parse({ reset, replay: outcome.response }));
        return;
      }
      sendReplayOutcome(res, outcome);
    } finally {
      start.done();
    }
  });

  return router;
}
