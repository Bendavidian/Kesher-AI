import { HealthResponse } from '@kesher/shared';
import express, { type ErrorRequestHandler, type Express } from 'express';
import type { Db } from 'mongodb';
import type { ProcessDeps } from './ingest/process';
import { createQueue } from './jobs/queue';
import { autoResearch } from './research/auto';
import type { InvestigateDeps } from './research/investigate';
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
  // Mounts Investigate and GET /reports/:reportId when set, with mcp and auth, and runs the
  // research gate after each scoring run. mcpUrl is the api's own POST /mcp, read when a run
  // starts; redact is applied to every run step.
  research?: { mcpUrl: () => string; redact: (text: string) => string };
  // Gets each FeedItem whose research state changed; the server passes the feed:update push.
  onResearch?: InvestigateDeps['onResearch'];
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
}: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');

  app.get('/health', (_req, res) => {
    res.json(HealthResponse.parse({ status: 'ok' }));
  });

  // After a scoring run: the cards go out first, then the gate decides on research, so a card
  // never waits for it (SPEC.md Pipeline).
  let afterScoring = onScored;

  if (mcp) app.use(mcpRouter(db, mcp.secret, logError));
  if (auth) {
    app.use(authRouter(db, auth));
    app.use(feedRouter(db, auth.secret));
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
        // One queue for automatic runs and Investigate: one research run at a time.
        queue: createQueue({ logError }),
        logError,
        ...(onResearch ? { onResearch } : {}),
      };
      app.use(researchRouter(deps, auth.secret));
      // A push that fails is logged; the gate still decides, since the event counts as scored
      // and is not scored again.
      afterScoring = async (eventId, scored) => {
        try {
          await onScored?.(eventId, scored);
        } catch (error) {
          logError(error);
        }
        await autoResearch(deps, eventId, scored);
      };
    }
  }
  if (devRoutes) app.use(devRouter(db, models, log, afterScoring));

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
