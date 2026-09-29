// SEC EDGAR access, shared by the graph build job and get_financial_facts. Fair access: a
// User-Agent with a contact (SEC_USER_AGENT, never printed) and at most 10 requests per second.
// Requests from one fetcher are spaced at least 150 ms apart.

const MIN_GAP_MS = 150;

export type Fetcher = (url: string, accept: string) => Promise<string>;

// The status travels with the error, so a caller can treat 404 as "not reported" and anything
// else as an outage. The message names the URL only, never the User-Agent.
export class SecHttpError extends Error {
  constructor(
    readonly status: number,
    url: string,
  ) {
    super(`HTTP ${status} from ${url}`);
    this.name = 'SecHttpError';
  }
}

export function secFetcher(userAgent: string): Fetcher {
  let nextAllowed = 0;
  return async (url, accept) => {
    // Reserved before waiting, so concurrent calls queue up instead of starting together.
    const start = Math.max(Date.now(), nextAllowed);
    nextAllowed = start + MIN_GAP_MS;
    const wait = start - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    const res = await fetch(url, {
      headers: { 'User-Agent': userAgent, Accept: accept },
      signal: AbortSignal.timeout(60_000),
    });
    const body = await res.text();
    if (!res.ok) throw new SecHttpError(res.status, url);
    return body;
  };
}
