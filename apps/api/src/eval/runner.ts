import { performance } from 'node:perf_hooks';
import {
  DEMO_PERSONAS,
  MarketEvent,
  Source,
  type Extraction,
  type InjectionScreen,
  type PersonaKey,
} from '@kesher/shared';
import { APICallError } from 'ai';
import type { Db } from 'mongodb';
import { collection } from '../db/collections';
import { applyReviews, countRelationships } from '../graph/apply';
import { loadCandidates, loadReviews } from '../graph/review';
import { toIncomingItem } from '../ingest/alpaca';
import { processItem, type ProcessResult } from '../ingest/process';
import { createModelClient, MODELS, type ModelClient } from '../llm/client';
import type { ModelRecording } from '../llm/recordings';
import { runSeed } from '../seed/seed';
// Test doubles in a dev-only job: the api runs from source through tsx, mongodb-memory-server is
// a devDependency and ai/test ships with ai, so nothing here reaches a production path.
import { mockModel, resolveMocks } from '../test/models';
import type { EvalItem } from './items';
import { PERSONA_KEYS } from './labels';

// Replays every eval item through the whole pipeline, processItem in replay mode, in a fresh
// database: the seed, the reviewed T11 edges, then each item in order. The models answer from
// their recordings, so no provider is called; a model without a recording fails the item.

export interface ItemRun {
  item: EvalItem;
  // failed: processItem threw, for example on an extraction the model refused; the item then has
  // no extraction and no card, as in the api.
  outcome: ProcessResult | { outcome: 'failed'; error: string };
  // What the pipeline stored: the screen label, the provider tags and the extraction.
  screen: InjectionScreen | null;
  tagged: string[];
  extraction: Extraction | null;
  relevance: Record<PersonaKey, number>;
  models: ModelRecording;
  // Wall time of processItem with the recorded answers: the code's own time, not the models'.
  codeMs: number;
}

export interface EvalRun {
  startedAt: Date;
  relationships: number;
  items: ItemRun[];
}

// The recorded answers of one item. Any other model, the Gemini fallback included, has no mock
// and fails the call, so a replay can never reach a provider.
export function replayModels(recording: ModelRecording): () => ModelClient {
  return () => {
    const guard = mockModel(MODELS.screen.model, recording.screen.chunks);
    const { extraction } = recording;
    const groq = mockModel(MODELS.extraction.model, [
      extraction.failure
        ? new APICallError({
            message: extraction.failure.message,
            url: 'https://replay.invalid/extraction',
            requestBodyValues: {},
            ...(extraction.failure.status === null
              ? {}
              : { statusCode: extraction.failure.status }),
            isRetryable: false,
          })
        : extraction.text,
    ]);
    return createModelClient({
      resolve: resolveMocks({ [guard.modelId]: guard, [groq.modelId]: groq }),
    });
  };
}

export async function seedEvalDb(db: Db, now: Date): Promise<number> {
  await runSeed(db, now);
  await applyReviews(db, await loadCandidates(), await loadReviews(), { now });
  return (await countRelationships(db)).relationships;
}

async function personaIds(db: Db): Promise<Map<string, PersonaKey>> {
  const users = await collection(db, 'users')
    .find({ email: { $in: DEMO_PERSONAS.map((p) => p.email) } })
    .project<{ _id: string; email: string }>({ _id: 1, email: 1 })
    .toArray();
  return new Map(users.map((u) => [u._id, DEMO_PERSONAS.find((p) => p.email === u.email)!.key]));
}

export async function runEval(
  db: Db,
  items: readonly EvalItem[],
  recordings: ReadonlyMap<string, ModelRecording>,
  { now = new Date(), log = () => undefined }: { now?: Date; log?: (m: string) => void } = {},
): Promise<EvalRun> {
  const relationships = await seedEvalDb(db, now);
  const personas = await personaIds(db);
  const runs: ItemRun[] = [];

  for (const item of items) {
    const models = recordings.get(item.id);
    if (!models) throw new Error(`no model recording for ${item.kind} item ${item.id}`);
    const incoming = toIncomingItem(item.item);
    const started = performance.now();
    const outcome = await processItem(db, incoming, {
      mode: 'replay',
      models: replayModels(models),
      now: () => now,
      log,
    }).catch((error: unknown) => ({
      outcome: 'failed' as const,
      error: error instanceof Error ? error.message : String(error),
    }));
    const codeMs = performance.now() - started;

    const relevance = Object.fromEntries(PERSONA_KEYS.map((p) => [p, 0])) as Record<
      PersonaKey,
      number
    >;
    let screen: InjectionScreen | null = null;
    let extraction: Extraction | null = null;
    if (outcome.outcome === 'failed') {
      const source = await collection(db, 'sources').findOne({
        provider: incoming.provider,
        externalId: incoming.externalId,
      });
      screen = source ? Source.parse(source).injectionScreen : null;
    }
    if (outcome.outcome === 'processed') {
      const source = Source.parse(
        await collection(db, 'sources').findOne({ _id: outcome.sourceId }),
      );
      screen = source.injectionScreen;
      const event = MarketEvent.parse(
        await collection(db, 'market_events').findOne({ _id: outcome.eventId }),
      );
      extraction = event.extraction;
      for (const feed of await collection(db, 'feed_items')
        .find({ eventId: outcome.eventId })
        .toArray()) {
        const persona = personas.get(feed.userId);
        if (persona) relevance[persona] = feed.relevance;
      }
    }
    runs.push({
      item,
      outcome,
      screen,
      tagged: incoming.symbols,
      extraction,
      relevance,
      models,
      codeMs,
    });
  }
  return { startedAt: now, relationships, items: runs };
}
