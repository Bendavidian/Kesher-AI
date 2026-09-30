import { performance } from 'node:perf_hooks';
import {
  DEMO_PERSONAS,
  MarketEvent,
  Source,
  type Extraction,
  type FeedPath,
  type InjectionScreen,
  type PersonaKey,
  type UniverseSymbol,
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
import { loadEdges } from '../relevance/graph';
import { bestPath, eventCompanies } from '../relevance/score';
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
  // What relevance would be if every provider tagged universe company were a start node, whatever
  // the extraction named: a counterfactual rule for the report, never written anywhere.
  taggedOnly: Record<PersonaKey, number>;
  // The scored path per persona as text, for example "TSM supplier_of NVDA"; null at relevance 0.
  paths: Record<PersonaKey, string | null>;
  pathKinds: Record<PersonaKey, PathKind>;
  models: ModelRecording;
  // Wall time of processItem with the recorded answers: the code's own time, not the models'.
  codeMs: number;
}

// How the scored path reaches the holding: the holding itself, one hop by its edge type, or two
// hops. none at relevance 0.
export type PathKind =
  'none' | 'direct' | 'supplier_of' | 'customer_of' | 'competitor_of' | 'two_hops';
export const PATH_KINDS: readonly PathKind[] = [
  'direct',
  'supplier_of',
  'customer_of',
  'competitor_of',
  'two_hops',
  'none',
];

export function pathKindOf(path: FeedPath | null): PathKind {
  if (!path) return 'none';
  if (path.hops.length === 0) return 'direct';
  return path.hops.length === 1 ? path.hops[0]!.type : 'two_hops';
}

// "TSM supplier_of NVDA": the event company, then each hop's type and the company it reaches.
export const pathText = (path: FeedPath | null): string | null =>
  path && [path.eventCompany, ...path.hops.map((h) => `${h.type} ${h.to}`)].join(' ');

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

interface Persona {
  key: PersonaKey;
  holdings: UniverseSymbol[];
}

async function personas(db: Db): Promise<Map<string, Persona>> {
  const users = await collection(db, 'users')
    .find({ email: { $in: DEMO_PERSONAS.map((p) => p.email) } })
    .project<{ _id: string; email: string; holdings: { symbol: UniverseSymbol }[] }>({
      _id: 1,
      email: 1,
      holdings: 1,
    })
    .toArray();
  return new Map(
    users.map((u) => [
      u._id,
      {
        key: DEMO_PERSONAS.find((p) => p.email === u.email)!.key,
        holdings: u.holdings.map((h) => h.symbol),
      },
    ]),
  );
}

const zeros = () =>
  Object.fromEntries(PERSONA_KEYS.map((p) => [p, 0])) as Record<PersonaKey, number>;

// The tagged only rule, with the same graph and the same best path as scoring. Each eval item is
// its own event, so its tags are the event's tags; scoring unions them over a cluster.
async function taggedOnlyRelevance(
  db: Db,
  tagged: readonly string[],
  users: ReadonlyMap<string, Persona>,
): Promise<Record<PersonaKey, number>> {
  const starts = eventCompanies(tagged, tagged);
  const edges = await loadEdges(db, starts);
  const result = zeros();
  for (const { key, holdings } of users.values()) {
    result[key] = bestPath(starts, holdings, edges).relevance;
  }
  return result;
}

export async function runEval(
  db: Db,
  items: readonly EvalItem[],
  recordings: ReadonlyMap<string, ModelRecording>,
  { now = new Date(), log = () => undefined }: { now?: Date; log?: (m: string) => void } = {},
): Promise<EvalRun> {
  const relationships = await seedEvalDb(db, now);
  const users = await personas(db);
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

    const relevance = zeros();
    const paths: Record<PersonaKey, string | null> = { A: null, B: null, C: null };
    const pathKinds: Record<PersonaKey, PathKind> = { A: 'none', B: 'none', C: 'none' };
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
        const persona = users.get(feed.userId);
        if (!persona) continue;
        relevance[persona.key] = feed.relevance;
        pathKinds[persona.key] = pathKindOf(feed.path);
        paths[persona.key] = pathText(feed.path);
      }
    }
    runs.push({
      item,
      outcome,
      screen,
      tagged: incoming.symbols,
      extraction,
      relevance,
      paths,
      pathKinds,
      // Like relevance, 0 for an item the pipeline did not score, so the rules compare on the same
      // items.
      taggedOnly:
        outcome.outcome === 'processed'
          ? await taggedOnlyRelevance(db, incoming.symbols, users)
          : zeros(),
      models,
      codeMs,
    });
  }
  return { startedAt: now, relationships, items: runs };
}
