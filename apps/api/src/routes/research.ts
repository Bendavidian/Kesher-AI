import { FeedCard, Id } from '@kesher/shared';
import { Router } from 'express';
import type { Db } from 'mongodb';
import { currentUser, requireUser } from '../auth/session';
import { feedCard, type CardMarket } from '../feed/cards';
import { startInvestigation, type InvestigateDeps } from '../research/investigate';
import { reportDetail } from '../research/report';
import { runDetail, runList } from '../research/runs';

// Investigate, the research report and the agent runs (docs/INTERFACES.md, REST). The user comes from the
// session cookie only; no route takes a user id.
export function researchRouter(deps: InvestigateDeps, secret: string, market?: CardMarket): Router {
  const { db } = deps;
  const router = Router();
  router.use(['/events', '/reports', '/runs'], requireUser(secret));

  // Answers 202 with the card in state running; the run goes on in the background and the card
  // follows it through feed:update.
  router.post('/events/:eventId/investigate', async (req, res) => {
    const eventId = Id.safeParse(req.params.eventId);
    if (!eventId.success) {
      res.status(400).json({ error: 'eventId must be an event id' });
      return;
    }
    const start = await startInvestigation(deps, currentUser(res), eventId.data);
    if (start.outcome === 'no_path') {
      res.status(404).json({ error: 'this event is not in your feed' });
      return;
    }
    if (start.outcome === 'already_running') {
      res.status(409).json({ error: 'research on this event is already running' });
      return;
    }
    const card = await cardOf(db, start.item, market);
    res.status(202).json(card);
  });

  router.get('/reports/:reportId', async (req, res) => {
    const reportId = Id.safeParse(req.params.reportId);
    if (!reportId.success) {
      res.status(400).json({ error: 'reportId must be a report id' });
      return;
    }
    const detail = await reportDetail(db, currentUser(res), reportId.data, market);
    if (!detail) {
      res.status(404).json({ error: 'no report with that id' });
      return;
    }
    res.json(detail);
  });

  router.get('/runs', async (_req, res) => {
    res.json(await runList(db, currentUser(res)));
  });

  // A run's steps as stored: tool output is redacted, capped and may quote untrusted text.
  router.get('/runs/:runId', async (req, res) => {
    const runId = Id.safeParse(req.params.runId);
    if (!runId.success) {
      res.status(400).json({ error: 'runId must be a run id' });
      return;
    }
    const detail = await runDetail(db, currentUser(res), runId.data);
    if (!detail) {
      res.status(404).json({ error: 'no run with that id' });
      return;
    }
    res.json(detail);
  });

  return router;
}

async function cardOf(
  db: Db,
  item: Parameters<typeof feedCard>[1],
  market: CardMarket | undefined,
): Promise<FeedCard> {
  const card = await feedCard(db, item, market);
  // The item has a path, so its event and source exist unless they were deleted in between.
  if (!card) throw new Error('the investigated event has no card');
  return FeedCard.parse(card);
}
