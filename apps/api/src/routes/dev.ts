import { ReplayResponse } from '@kesher/shared';
import { Router } from 'express';
import type { Db } from 'mongodb';
import { toIncomingItem } from '../ingest/alpaca';
import { ingestItem } from '../ingest/ingest';
import { AlpacaNewsId, loadRecording } from '../ingest/recordings';

// Development only (docs/INTERFACES.md, REST); createApp mounts this outside production.
export function devRouter(db: Db): Router {
  const router = Router();

  // Replays one recorded Alpaca news item by its Alpaca id, never by keyword, through the same
  // ingest path as live items.
  router.post('/dev/replay/:sourceId', async (req, res) => {
    const id = AlpacaNewsId.safeParse(req.params.sourceId);
    if (!id.success) {
      res.status(400).json({ error: 'sourceId must be an Alpaca news id' });
      return;
    }
    const recording = await loadRecording(id.data);
    if (!recording) {
      res.status(404).json({ error: `no recording for Alpaca news ${id.data}` });
      return;
    }
    const result = await ingestItem(db, toIncomingItem(recording.item));
    res.json(ReplayResponse.parse({ outcome: 'processed', ...result }));
  });

  return router;
}
