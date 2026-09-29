import { HealthResponse } from '@kesher/shared';
import express, { type ErrorRequestHandler, type Express } from 'express';
import type { Db } from 'mongodb';
import type { ProcessDeps } from './ingest/process';
import type { InvestigateDeps } from './research/investigate';
import type { PriceReactions } from './market/reactions';
import { createModelClient, resolveFromKeys, type ModelClient } from './llm/client';
import { authRouter, type AuthOptions } from './routes/auth';
import { devRouter } from './routes/dev';
import { feedRouter } from './routes/feed';
import { mcpRouter } from './routes/mcp';
import { researchRouter } from './routes/research';

export interface AppDeps {
  db: Db;
  // Mounts the development routes, such as POST /dev/replay. Off in production.
  devRoutes: boolean;
  // Mounts POST /mcp when set. The secret verifies run tokens (MCP_TOKEN_SECRET).
  mcp?: { secret: string };
  // Mounts sign in, GET /me, GET /feed and explain when set. The secret is JWT_SECRET.
  auth?: AuthOptions;
  // Gets what each scoring run wrote; the server passes the Socket.IO pushes.
  onScored?: ProcessDeps['onScored'];
  // Where request errors go. The server passes a logger that redacts secrets.
  logError?: (error: unknown) => void;
  // Pipeline messages, such as an update that was not processed again. Redacted by the server.
  log?: (message: string) => void;
  // The model client, built on first use. Without it every model call fails naming its key.
  models?: () => ModelClient;
  // Mounts Investigate and GET /reports/:reportId when set, with mcp and auth. mcpUrl is the
  // api's own POST /mcp, read when a run starts; redact is applied to every run step.
  research?: { mcpUrl: () => string; redact: (text: string) => string };
  // Gets each FeedItem whose research state changed; the server passes the feed:update push.
  onResearch?: InvestigateDeps['onResearch'];
  // The price reaction over the api's market data (createPriceReactions), for get_price_reaction
  // and FeedCard.priceReaction. Without it cards carry null and the tool answers unavailable.
  priceReactions?: PriceReactions;
}

const logMessage = (error: unknown) =>
  console.error(error instanceof Error ? error.message : 'request failed');

const noKeys = () => createModelClient({ resolve: resolveFromKeys({}) });

export function createApp({
  db,
  devRoutes,
  mcp,
  auth,
  onScored,
  logError = logMessage,
  log = console.log,
  models = noKeys,
  research,
  onResearch,
  priceReactions,
}: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');

  app.get('/health', (_req, res) => {
    res.json(HealthResponse.parse({ status: 'ok' }));
  });

  if (mcp) app.use(mcpRouter(db, mcp.secret, logError, priceReactions));
  if (auth) {
    app.use(authRouter(db, auth));
    // Every card the api sends carries the same price reaction.
    const market = priceReactions && { priceReaction: priceReactions, logError };
    app.use(feedRouter(db, auth.secret, market));
    if (mcp && research) {
      const deps: InvestigateDeps = {
        db,
        models,
        mcp: {
          secret: mcp.secret,
          // Read when a run starts, after the server listens.
          get url() {
            return research.mcpUrl();
          },
        },
        redact: research.redact,
        logError,
        ...(onResearch ? { onResearch } : {}),
      };
      app.use(researchRouter(deps, auth.secret, market));
    }
  }
  if (devRoutes) app.use(devRouter(db, models, log, onScored));

  // Answers without internals; driver errors can carry connection details.
  const onError: ErrorRequestHandler = (error, _req, res, next) => {
    logError(error);
    if (res.headersSent) {
      next(error);
      return;
    }
    res.status(500).json({ error: 'internal error' });
  };
  app.use(onError);

  return app;
}
