import { Router, type Response } from 'express';
import type { Db } from 'mongodb';
import {
  describeTarget,
  parseSourceId,
  replayItem,
  resetItem,
  type ReplayOutcome,
} from '../ingest/replay';
import type { ProcessDeps } from '../ingest/process';
import type { ModelClient } from '../llm/client';

const BAD_ID = 'sourceId must be an Alpaca news id or an EDGAR accession number';

// Answers a replay outcome the way POST /dev/replay always has; the demo route shares it.
export function sendReplayOutcome(
  res: Response,
  outcome: Exclude<ReplayOutcome, { kind: 'no_recording' }>,
): void {
  switch (outcome.kind) {
    case 'replayed':
      res.json(outcome.response);
      return;
    case 'missing_key':
      res.status(503).json({ error: `${outcome.message}; the screen and extraction need it` });
      return;
    case 'rate_limited':
      res.status(503).json({ error: 'the model providers are rate limited; replay again later' });
      return;
  }
}

// Development only (docs/INTERFACES.md, REST); createApp mounts this outside production.
export function devRouter(
  db: Db,
  models: () => ModelClient,
  log: (message: string) => void,
  onScored?: ProcessDeps['onScored'],
  embedder?: ProcessDeps['embedder'],
): Router {
  const router = Router();

  router.post('/dev/reset/:sourceId', async (req, res) => {
    const target = parseSourceId(req.params.sourceId);
    if (!target) {
      res.status(400).json({ error: BAD_ID });
      return;
    }
    const reset = await resetItem(db, target);
    if (!reset) {
      res.status(404).json({ error: `${describeTarget(target)} has not been replayed` });
      return;
    }
    res.json(reset);
  });

  router.post('/dev/replay/:sourceId', async (req, res) => {
    const target = parseSourceId(req.params.sourceId);
    if (!target) {
      res.status(400).json({ error: BAD_ID });
      return;
    }
    const outcome = await replayItem(db, target, {
      models,
      log,
      ...(onScored ? { onScored } : {}),
      ...(embedder ? { embedder } : {}),
    });
    if (outcome.kind === 'no_recording') {
      res.status(404).json({ error: `no recording for ${describeTarget(target)}` });
      return;
    }
    sendReplayOutcome(res, outcome);
  });

  return router;
}
