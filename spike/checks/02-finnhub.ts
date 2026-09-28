// Finnhub: peers and profile for NVDA and TSM.
import { http, pickHeaders, type Check } from '../lib.ts';

const UNIVERSE = ['NVDA', 'MSFT', 'AMZN', 'GOOGL', 'META', 'AMD', 'AVGO', 'INTC', 'QCOM', 'MU', 'TSM', 'ASML', 'AMAT', 'LRCX'];

const check: Check = {
  name: 'finnhub',
  title: 'Finnhub: peers and company profiles',
  keys: ['FINNHUB_API_KEY'],
  async run(ctx) {
    // The token goes in a header, never in the URL.
    const headers = { 'X-Finnhub-Token': ctx.env('FINNHUB_API_KEY')! };
    const base = 'https://finnhub.io/api/v1';

    const peers = await http<string[]>(`${base}/stock/peers?symbol=NVDA`, { headers });
    const profiles: Record<string, unknown> = {};
    let rateLimit: Record<string, string> = {};
    for (const symbol of ['NVDA', 'TSM']) {
      const p = await http<any>(`${base}/stock/profile2?symbol=${symbol}`, { headers });
      rateLimit = pickHeaders(p.headers, 'x-ratelimit');
      profiles[symbol] = {
        name: p.body.name,
        ticker: p.body.ticker,
        exchange: p.body.exchange,
        country: p.body.country,
        industry: p.body.finnhubIndustry,
        ms: p.ms,
      };
    }

    const peerList = peers.body;
    const evidence = {
      nvdaPeers: peerList,
      nvdaPeersInUniverse: peerList.filter((s) => UNIVERSE.includes(s)),
      peersMs: peers.ms,
      profiles,
      rateLimitHeaders: rateLimit,
    };
    const limits = ['Free plan: 60 calls per minute (see rateLimitHeaders for the observed values).'];
    const ok =
      Array.isArray(peerList) &&
      peerList.length > 0 &&
      Object.values(profiles).every((p: any) => p.name && p.ticker);
    return ok
      ? { status: 'pass', evidence, limits }
      : { status: 'fail', reason: 'Empty peers or incomplete profile', evidence, limits };
  },
};

export default check;
