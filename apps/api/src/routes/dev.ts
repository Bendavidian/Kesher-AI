import { AccessionNumber, Company, ReplayResponse, ResetResponse } from '@kesher/shared';
import { Router } from 'express';
import type { Db } from 'mongodb';
import { toIncomingItem } from '../ingest/alpaca';
import { processItem, type ProcessDeps } from '../ingest/process';
import { collection } from '../db/collections';
import { toIncomingFiling } from '../ingest/edgar';
import type { IncomingItem } from '../ingest/item';
import { AlpacaNewsId, findRecording, type LiveItem } from '../ingest/recordings';
import { isRateLimited, MissingModelKeyError, type ModelClient } from '../llm/client';

type Provider = LiveItem['provider'];

// A replay id names its provider by its shape: an Alpaca news id is digits only, an EDGAR
// accession number is 0001045810-26-000021.
function parseSourceId(raw: string): { provider: Provider; externalId: string } | null {
  if (AlpacaNewsId.safeParse(raw).success) return { provider: 'alpaca', externalId: raw };
  if (AccessionNumber.safeParse(raw).success) return { provider: 'sec_edgar', externalId: raw };
  return null;
}

const BAD_ID = 'sourceId must be an Alpaca news id or an EDGAR accession number';
const label = (provider: Provider) => (provider === 'alpaca' ? 'Alpaca news' : 'EDGAR filing');

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
    const id = parseSourceId(req.params.sourceId);
    if (!id) {
      res.status(400).json({ error: BAD_ID });
      return;
    }
    const source = await collection(db, 'sources').findOne(id);
    const event =
      source && (await collection(db, 'market_events').findOne({ sourceIds: source._id }));
    if (!source || !event) {
      res
        .status(404)
        .json({ error: `${label(id.provider)} ${id.externalId} has not been replayed` });
      return;
    }
    const { deletedCount } = await collection(db, 'feed_items').deleteMany({ eventId: event._id });
    res.json(
      ResetResponse.parse({ sourceId: source._id, eventId: event._id, deleted: deletedCount }),
    );
  });

  // The recording mapped the way live ingestion maps it. A filing takes its symbol and name from
  // the universe company with its CIK; null when that company is not seeded.
  const incoming = async (live: LiveItem): Promise<IncomingItem | null> => {
    if (live.provider === 'alpaca') return toIncomingItem(live.item);
    const company = await collection(db, 'companies').findOne({ cik: live.item.cik });
    return company ? toIncomingFiling(live.item, Company.parse(company)) : null;
  };

  // Replays one recorded item by its provider id, never by keyword, through the same pipeline as
  // live items: pre filter, injection screen, extraction. The committed recording file is read
  // first, then the live recordings collection.
  router.post('/dev/replay/:sourceId', async (req, res) => {
    const id = parseSourceId(req.params.sourceId);
    if (!id) {
      res.status(400).json({ error: BAD_ID });
      return;
    }
    const recording = await findRecording(db, id.provider, id.externalId);
    const item = recording && (await incoming(recording));
    if (!item) {
      res.status(404).json({ error: `no recording for ${label(id.provider)} ${id.externalId}` });
      return;
    }
    try {
      const result = await processItem(db, item, {
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
