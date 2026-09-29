import { ReplayResponse, ResetResponse } from '@kesher/shared';
import { Router } from 'express';
import type { Db } from 'mongodb';
import { toIncomingItem } from '../ingest/alpaca';
import { processItem, type ProcessDeps } from '../ingest/process';
import { collection } from '../db/collections';
import { AlpacaNewsId, loadRecording } from '../ingest/recordings';
import { isRateLimited, MissingModelKeyError, type ModelClient } from '../llm/client';

// Development only (docs/INTERFACES.md, REST); createApp mounts this outside production.
export function devRouter(
  db: Db,
  models: () => ModelClient,
  log: (message: string) => void,
  onScored?: ProcessDeps['onScored'],
  embedder?: ProcessDeps['embedder'],
): Router {
  const router = Router();

  // Deletes the FeedItems of a replayed item's event and nothing else: the Source, the event and
  // its extraction stay. The next replay then scores the event again with no model call and pushes
  // it as a new arrival, as live ingestion would. A replay without a reset stays a duplicate.
  router.post('/dev/reset/:sourceId', async (req, res) => {
    const id = AlpacaNewsId.safeParse(req.params.sourceId);
    if (!id.success) {
      res.status(400).json({ error: 'sourceId must be an Alpaca news id' });
      return;
    }
    const source = await collection(db, 'sources').findOne({
      provider: 'alpaca',
      externalId: id.data,
    });
    const event =
      source && (await collection(db, 'market_events').findOne({ sourceIds: source._id }));
    if (!source || !event) {
      res.status(404).json({ error: `Alpaca news ${id.data} has not been replayed` });
      return;
    }
    const { deletedCount } = await collection(db, 'feed_items').deleteMany({ eventId: event._id });
    res.json(
      ResetResponse.parse({ sourceId: source._id, eventId: event._id, deleted: deletedCount }),
    );
  });

  // Replays one recorded Alpaca news item by its Alpaca id, never by keyword, through the same
  // pipeline as live items: pre filter, injection screen, extraction.
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
    try {
      const result = await processItem(db, toIncomingItem(recording.item), {
        mode: 'replay',
        models,
        log,
        ...(onScored ? { onScored } : {}),
        ...(embedder ? { embedder } : {}),
      });
      res.json(ReplayResponse.parse(result));
    } catch (error) {
      // The item is stored without an extraction and resumes on the next replay.
      if (error instanceof MissingModelKeyError) {
        res.status(503).json({ error: `${error.message}; the screen and extraction need it` });
        return;
      }
      if (isRateLimited(error)) {
        res.status(503).json({ error: 'the model providers are rate limited; replay again later' });
        return;
      }
      throw error;
    }
  });

  return router;
}
