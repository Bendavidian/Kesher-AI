// Gemini Flash-Lite on the Google AI Studio free tier: one structured output call.
import { google } from '@ai-sdk/google';
import { http, type Check } from '../lib.ts';
import { runExtraction } from '../extraction.ts';

export async function listGeminiModels(apiKey: string) {
  const res = await http<any>('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000', {
    headers: { 'x-goog-api-key': apiKey },
  });
  return res.body.models as { name: string; supportedGenerationMethods: string[] }[];
}

// Newest stable Flash-Lite first; previews only if no stable one exists.
function pickFlashLite(names: string[]) {
  const lite = names.filter((n) => /flash-lite/.test(n) && !/tts|image|live|audio|exp/.test(n));
  const version = (n: string) => Number(n.match(/gemini-(\d+(?:\.\d+)?)/)?.[1] ?? 0);
  const sorted = lite.sort((a, b) => version(b) - version(a));
  return sorted.find((n) => !/preview/.test(n)) ?? sorted[0];
}

const check: Check = {
  name: 'gemini',
  title: 'Gemini Flash-Lite: structured output call',
  keys: ['GOOGLE_GENERATIVE_AI_API_KEY'],
  async run(ctx) {
    const models = await listGeminiModels(ctx.env('GOOGLE_GENERATIVE_AI_API_KEY')!);
    const names = models
      .filter((m) => m.supportedGenerationMethods.includes('generateContent'))
      .map((m) => m.name.replace(/^models\//, ''));
    const modelId = pickFlashLite(names);
    const limits = [
      'Free tier quotas are per model and per day; Google returns 429 when exceeded.',
      'Billing must stay off on the key\'s Google Cloud project, or calls are charged.',
    ];
    if (!modelId) return { status: 'fail', reason: 'No Flash-Lite model available', evidence: { names }, limits };
    ctx.log(`model ${modelId}`);

    const extraction = await runExtraction(ctx, google(modelId));
    const evidence = {
      model: modelId,
      flashLiteCandidates: names.filter((n) => /flash-lite/.test(n)),
      ...extraction,
      consoleDailyQuota: 'TO FILL from aistudio.google.com (Usage and rate limits)',
    };
    return extraction.findsTsm
      ? { status: 'pass', evidence, limits }
      : { status: 'partial', reason: 'Valid structured output, but TSM was not extracted', evidence, limits };
  },
};

export default check;
