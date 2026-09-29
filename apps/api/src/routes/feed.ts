import { FeedCard, Id } from '@kesher/shared';
import { Router } from 'express';
import type { Db } from 'mongodb';
import { currentUser, requireUser } from '../auth/session';
import { feedCardsFor, type CardMarket } from '../feed/cards';
import { explainEvent } from '../feed/explain';

// GET /feed and GET /events/:eventId/explain (docs/INTERFACES.md, REST). Both answer for the
// signed in user only; no query or path parameter names a user.
export function feedRouter(db: Db, secret: string, market?: CardMarket): Router {
  const router = Router();
  router.use(['/feed', '/events'], requireUser(secret));

  router.get('/feed', async (_req, res) => {
    const cards = await feedCardsFor(db, currentUser(res), { market });
    res.json(cards.map((card) => FeedCard.parse(card)));
  });

  router.get('/events/:eventId/explain', async (req, res) => {
    const eventId = Id.safeParse(req.params.eventId);
    if (!eventId.success) {
      res.status(400).json({ error: 'eventId must be an event id' });
      return;
    }
    const explain = await explainEvent(db, eventId.data, currentUser(res));
    if (!explain) {
      res.status(404).json({ error: 'no extracted event with that id' });
      return;
    }
    res.json(explain);
  });

  return router;
}
