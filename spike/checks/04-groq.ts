// Groq: one structured output call on the free tier.
import { groq } from '@ai-sdk/groq';
import { http, type Check } from '../lib.ts';
import { runExtraction } from '../extraction.ts';

// Models with strict json_schema support first (per the @ai-sdk/groq docs), then fallbacks.
const PREFERRED = [
  'openai/gpt-oss-120b',
  'openai/gpt-oss-20b',
  'moonshotai/kimi-k2-instruct-0905',
  'meta-llama/llama-4-scout-17b-16e-instruct',
  'llama-3.3-70b-versatile',
];

const check: Check = {
  name: 'groq',
  title: 'Groq: structured output call',
  keys: ['GROQ_API_KEY'],
  async run(ctx) {
    const list = await http<any>('https://api.groq.com/openai/v1/models', {
      headers: { Authorization: `Bearer ${ctx.env('GROQ_API_KEY')}` },
    });
    const available: string[] = list.body.data.map((m: any) => m.id);
    const modelId = PREFERRED.find((m) => available.includes(m));
    const limits = ['Free tier limits per model: see rateLimitHeaders and the console quota below.'];
    if (!modelId) {
      return { status: 'fail', reason: 'None of the preferred models is available', evidence: { available }, limits };
    }
    ctx.log(`model ${modelId}`);

    const extraction = await runExtraction(ctx, groq(modelId), 'x-ratelimit');
    const evidence = {
      model: modelId,
      modelsAvailable: available.length,
      ...extraction,
      consoleDailyQuota: 'TO FILL from console.groq.com (Settings, Limits)',
    };
    return extraction.findsTsm
      ? { status: 'pass', evidence, limits }
      : { status: 'partial', reason: 'Valid structured output, but TSM was not extracted', evidence, limits };
  },
};

export default check;
