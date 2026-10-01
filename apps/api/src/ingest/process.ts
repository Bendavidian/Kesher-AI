import { Source, type IngestMode, type ReplayResponse } from '@kesher/shared';
import type { Db } from 'mongodb';
import { describeError } from '../config/redact';
import { collection } from '../db/collections';
import { embedEvent, type LazyEmbedder } from '../embed/event';
import { ExtractionFailedError, extractSource } from '../extract/extraction';
import { isSchemaFailure, MissingModelKeyError, type ModelClient } from '../llm/client';
import { isScored, scoreEvent, type ScoredItem } from '../relevance/feed';
import { screenInput, screenText } from '../screen/injection';
import { countDrop } from './counters';
import { ingestItem } from './ingest';
import type { IncomingItem } from './item';
import { changedFields, passesUniverse, repeatReason } from './prefilter';

export interface ProcessDeps {
  mode: IngestMode;
  // Called only when a step needs a model, so dropped and already processed items need no key.
  models: () => ModelClient;
  // The local embedding model, loaded on first use. Without it events keep embedding null until
  // npm run embed:events.
  embedder?: LazyEmbedder;
  now?: () => Date;
  log?: (message: string) => void;
  // Gets what a scoring run wrote, for the socket pushes. Its failure is logged and never undoes
  // or repeats the processing.
  onScored?: (eventId: string, scored: ScoredItem[]) => Promise<void>;
}

export type ProcessResult = ReplayResponse;

// Processed means extracted and scored. Such an item is never extracted again; one stored
// without either resumes when it comes again. null when the item is not processed.
export async function findProcessed(
  db: Db,
  { provider, externalId }: Pick<IncomingItem, 'provider' | 'externalId'>,
): Promise<{ source: Source; eventId: string } | null> {
  const stored = await collection(db, 'sources').findOne({ provider, externalId });
  if (!stored) return null;
  const event = await collection(db, 'market_events').findOne({ sourceIds: stored._id });
  if (!event?.extraction || !(await isScored(db, event._id))) return null;
  return { source: stored, eventId: event._id };
}

// The single entry for every item, replayed or live, in the SPEC.md order: pre filter, then the
// injection screen, then extraction, then propagation and relevance. Every decision and write here
// is deterministic code; the models only label and extract. A step that already ran is skipped, so
// an item whose extraction or scoring did not finish resumes on the next try.
export async function processItem(
  db: Db,
  item: IncomingItem,
  { mode, models, embedder, now = () => new Date(), log = console.log, onScored }: ProcessDeps,
): Promise<ProcessResult> {
  if (!passesUniverse(item.symbols)) {
    await countDrop(db, 'not_in_universe', mode, now());
    return { outcome: 'dropped', reason: 'not_in_universe' };
  }

  const sources = collection(db, 'sources');
  const events = collection(db, 'market_events');

  const processed = await findProcessed(db, item);
  if (processed) {
    const { source: stored, eventId } = processed;
    const reason = repeatReason(stored, item);
    if (reason === 'update') {
      const fields = changedFields(stored, item).join(', ');
      log(`update to ${item.provider} ${item.externalId} not processed again (${fields})`);
    }
    await countDrop(db, reason, mode, now());
    return { outcome: 'dropped', reason, sourceId: stored._id, eventId };
  }

  const ingested = await ingestItem(db, item, now());
  // The stored version, so the screen and the extraction read the same text.
  const source = Source.parse(await sources.findOne({ _id: ingested.sourceId }));

  if (source.injectionScreen === null) {
    // Fails open: the screen is a label that decides nothing, so its outage must not gate either.
    try {
      const injectionScreen = await screenText(models(), screenInput(source), now());
      await sources.updateOne(
        { _id: source._id, injectionScreen: null },
        { $set: { injectionScreen } },
      );
    } catch (error) {
      if (error instanceof MissingModelKeyError) throw error;
      log(
        `injection screen failed for ${source.provider} ${source.externalId}: ${describeError(error)}`,
      );
    }
  }

  const event = await events.findOne({ _id: ingested.eventId });
  if (!event?.extraction) {
    const { extraction } = await extractSource(models(), source, now(), {
      schemaRetry: true,
    }).catch(async (error: unknown) => {
      if (!isSchemaFailure(error)) throw error;
      // Counted, unlike a 429 or a missing key: the providers answered, and every answer was
      // unusable (SPEC.md decision log, T19). A failed count must not hide the failure.
      try {
        await countDrop(db, 'extraction_failed', mode, now());
      } catch (countError) {
        log(`counting the failed extraction failed: ${describeError(countError)}`);
      }
      log(
        `extraction of ${source.provider} ${source.externalId} failed its schema on every provider it reached; it resumes on the next try`,
      );
      throw new ExtractionFailedError(source);
    });
    await events.updateOne({ _id: ingested.eventId, extraction: null }, { $set: { extraction } });
  }

  // The event vector for search. Fails open like the screen: relevance does not use it, and
  // npm run embed:events fills what is missing.
  if (embedder && event && event.embedding === null) {
    try {
      await embedEvent(db, await embedder(), event);
    } catch (error) {
      log(`embedding failed for event ${event._id}: ${describeError(error)}`);
    }
  }

  // Code only: the graph, relevance and one FeedItem per user. A card never waits for research.
  if (!(await isScored(db, ingested.eventId))) {
    const scored = await scoreEvent(db, ingested.eventId, now());
    try {
      await onScored?.(ingested.eventId, scored);
    } catch (error) {
      log(`push for event ${ingested.eventId} failed: ${describeError(error)}`);
    }
  }

  return { outcome: 'processed', ...ingested };
}
