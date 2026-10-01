import { IngestStatus, type LiveStatus } from '@kesher/shared';
import { Router } from 'express';
import type { Db } from 'mongodb';
import { requireUser } from '../auth/session';
import { ingestStatus } from '../ingest/status';

// GET /ingest/status (docs/INTERFACES.md, REST): the live ingestion status for any signed in
// user. It is the same for everyone and names no user; liveStatus reads the process's own
// stream, poller and queue, and answers null where LIVE_INGEST is off.
export function ingestRouter(
  db: Db,
  secret: string,
  liveStatus: () => LiveStatus | null = () => null,
): Router {
  const router = Router();
  router.get('/ingest/status', requireUser(secret), async (_req, res) => {
    res.json(IngestStatus.parse(await ingestStatus(db, liveStatus(), new Date())));
  });
  return router;
}
