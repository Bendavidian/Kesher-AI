import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  createMcpFetch,
  type CompanyConceptSource,
  type SearchBackend,
  type ToolDeps,
} from '@kesher/mcp';
import { PriceReactionError } from '@kesher/shared';
import express, {
  Router,
  type ErrorRequestHandler,
  type Request as ExpressRequest,
  type Response as ExpressResponse,
} from 'express';
import type { Db } from 'mongodb';
import { collection } from '../db/collections';
import { loggedSearch } from '../search/atlas';
import { bodyError } from './bodyError';

// The JSON body is passed to the SDK already parsed, so the web Request carries headers only.
function toWebRequest(req: ExpressRequest): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    headers.set(name, Array.isArray(value) ? value.join(', ') : value);
  }
  const url = new URL(req.originalUrl, `http://${req.headers.host ?? 'localhost'}`);
  return new Request(url, { method: req.method, headers });
}

async function sendWebResponse(res: ExpressResponse, response: Response): Promise<void> {
  res.status(response.status);
  response.headers.forEach((value, name) => res.setHeader(name, value));
  if (!response.body) {
    res.end();
    return;
  }
  // Streams SSE responses as they arrive; JSON responses are a single chunk.
  await pipeline(Readable.fromWeb(response.body), res);
}

// A body the parser refused answers in JSON-RPC, which MCP clients read, instead of the REST
// shape of app.ts (SPEC.md decision log, T30): not JSON is a parse error, any other an invalid
// request. No request id was read, so id is null.
const RPC_BODY_ERROR = {
  invalid_json: { code: -32700, message: 'Parse error' },
  too_large: { code: -32600, message: 'Request body too large' },
  unreadable: { code: -32600, message: 'Unreadable request body' },
} as const;

const onBodyError: ErrorRequestHandler = (error, _req, res, next) => {
  const body = bodyError(error);
  if (!body) {
    next(error);
    return;
  }
  res.status(body.status).json({ jsonrpc: '2.0', error: RPC_BODY_ERROR[body.kind], id: null });
};

// Without market data, get_price_reaction answers so, and nothing is logged as a failure.
const noMarketData: ToolDeps['priceReaction'] = () =>
  Promise.reject(new PriceReactionError('market data is not configured'));

// Without SEC access, get_financial_facts answers that SEC data is unavailable.
const noSecData: CompanyConceptSource = () =>
  Promise.reject(new Error('SEC data is not configured'));

export interface McpRouterOptions {
  onError?: (error: Error) => void;
  priceReaction?: ToolDeps['priceReaction'];
  // SEC XBRL values (sec/xbrl.ts), recorded ones in tests.
  companyConcept?: CompanyConceptSource;
  // Atlas search in the api (search/atlas.ts), an in memory backend in tests.
  search: SearchBackend;
}

// POST /mcp (docs/INTERFACES.md): stateless MCP over HTTP, authorized by the run token alone.
export function mcpRouter(
  db: Db,
  secret: string,
  { onError, priceReaction = noMarketData, search, companyConcept = noSecData }: McpRouterOptions,
): Router {
  const serve = createMcpFetch({
    secret,
    deps: {
      users: collection(db, 'users'),
      events: collection(db, 'market_events'),
      sources: collection(db, 'sources'),
      relationships: collection(db, 'relationships'),
      companies: collection(db, 'companies'),
      search: loggedSearch(search, onError),
      // Logged here, like the other outside services; the tool tells the agent only that SEC
      // data is unavailable.
      companyConcept: (symbol, concept) =>
        companyConcept(symbol, concept).catch((error: unknown) => {
          if (error instanceof Error) onError?.(error);
          throw error;
        }),
      // A provider failure is logged here and rethrown on purpose: the tool turns it into
      // "Market data is unavailable", so the agent never sees the provider's message.
      priceReaction: (subjects, headline) =>
        priceReaction(subjects, headline).catch((error: unknown) => {
          if (!(error instanceof PriceReactionError) && error instanceof Error) onError?.(error);
          throw error;
        }),
    },
    ...(onError ? { onError } : {}),
  });
  const router = Router();
  router.all('/mcp', express.json({ limit: '1mb' }), async (req, res) => {
    await sendWebResponse(res, await serve(toWebRequest(req), req.body));
  });
  router.use('/mcp', onBodyError);
  return router;
}
