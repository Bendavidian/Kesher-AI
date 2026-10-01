import { performance } from 'node:perf_hooks';
import { APICallError } from 'ai';
import type { IncomingItem } from '../ingest/item';
import { MODELS, type ModelClient } from '../llm/client';
import { systemClock, type Clock } from '../llm/limiter';
import { ModelRecording } from '../llm/recordings';
import { chunkText, screenInput } from '../screen/injection';
import { extractSource, type ExtractionResult } from './extraction';

// Runs the injection screen and the extraction for real, once, on one item, and returns the raw
// answers with their usage and latency. Used by npm run record:models and npm run eval --
// --record; tests replay the result through mock models. Free tier calls only: one prompt guard
// call per chunk and one extraction.
export async function recordModels(
  client: ModelClient,
  externalId: string,
  item: IncomingItem,
  { now = new Date(), waitedMs = () => 0 }: { now?: Date; waitedMs?: () => number } = {},
): Promise<ModelRecording> {
  // Latency is the call's own time: the limiter's waits for the free tier are left out.
  const timed = async <T>(run: () => Promise<T>): Promise<[T, number]> => {
    const started = performance.now();
    const waited = waitedMs();
    const result = await run();
    const ms = performance.now() - started - (waitedMs() - waited);
    return [result, Math.max(0, Math.round(ms))];
  };

  const input = screenInput(item);
  const chunks: string[] = [];
  const screenLatency: number[] = [];
  let screenModel = '';
  for (const chunk of chunkText(input)) {
    const [answer, ms] = await timed(() => client.screenChunk(chunk));
    screenLatency.push(ms);
    chunks.push(answer.text);
    screenModel = answer.model;
  }

  const [result, extractionLatency] = await timed(
    async (): Promise<ExtractionResult | { refused: APICallError }> => {
      try {
        return await extractSource(client, item, now);
      } catch (error) {
        // A 429 is the free tier's limit, not an answer: it is never recorded.
        if (APICallError.isInstance(error) && error.statusCode !== 429) return { refused: error };
        throw error;
      }
    },
  );
  if ('refused' in result) {
    const { refused } = result;
    return ModelRecording.parse({
      externalId,
      recordedAt: now.toISOString(),
      screen: { model: screenModel, input, chunks, latencyMs: screenLatency },
      extraction: {
        // The error does not name its provider. generateSingle falls back to Gemini only on a
        // 429, so a refusal that reaches here came from the extraction model.
        provider: MODELS.extraction.provider,
        model: MODELS.extraction.model,
        text: failedGeneration(refused) ?? refused.message,
        usage: { inputTokens: null, outputTokens: null, totalTokens: null },
        latencyMs: extractionLatency,
        failure: { status: refused.statusCode ?? null, message: refused.message },
      },
    });
  }

  return ModelRecording.parse({
    externalId,
    recordedAt: now.toISOString(),
    screen: { model: screenModel, input, chunks, latencyMs: screenLatency },
    extraction: {
      provider: result.extraction.provider,
      model: result.extraction.model,
      text: result.text,
      usage: {
        inputTokens: result.usage.inputTokens ?? null,
        outputTokens: result.usage.outputTokens ?? null,
        totalTokens: result.usage.totalTokens ?? null,
      },
      latencyMs: extractionLatency,
    },
  });
}

// The system clock, counting the time the limiter spends waiting, for recordModels.
export function countingClock(clock: Clock = systemClock): Clock & { waitedMs: () => number } {
  let waited = 0;
  return {
    now: () => clock.now(),
    async sleep(ms) {
      waited += ms;
      await clock.sleep(ms);
    },
    waitedMs: () => waited,
  };
}

// Groq returns the generation it rejected against the schema as error.failed_generation.
function failedGeneration(error: APICallError): string | null {
  try {
    const body = JSON.parse(error.responseBody ?? '') as {
      error?: { failed_generation?: unknown };
    };
    const text = body.error?.failed_generation;
    return typeof text === 'string' && text.trim() !== '' ? text : null;
  } catch {
    return null;
  }
}
