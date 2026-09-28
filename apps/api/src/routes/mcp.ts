import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createMcpFetch } from '@kesher/mcp';
import express, {
  Router,
  type ErrorRequestHandler,
  type Request as ExpressRequest,
  type Response as ExpressResponse,
} from 'express';
import type { Db } from 'mongodb';
import { collection } from '../db/collections';

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

// Answers a malformed body as a client error instead of the app's generic 500.
const onBadJson: ErrorRequestHandler = (error: { type?: string }, _req, res, next) => {
  if (error.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'invalid json' });
    return;
  }
  next(error);
};

// POST /mcp (docs/INTERFACES.md): stateless MCP over HTTP, authorized by the run token alone.
export function mcpRouter(db: Db, secret: string, onError?: (error: Error) => void): Router {
  const serve = createMcpFetch({
    secret,
    deps: { events: collection(db, 'market_events'), sources: collection(db, 'sources') },
    ...(onError ? { onError } : {}),
  });
  const router = Router();
  router.all('/mcp', express.json({ limit: '1mb' }), async (req, res) => {
    await sendWebResponse(res, await serve(toWebRequest(req), req.body));
  });
  router.use('/mcp', onBadJson);
  return router;
}
