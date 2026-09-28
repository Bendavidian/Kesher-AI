import { HealthResponse } from '@kesher/shared';
import express, { type ErrorRequestHandler, type Express } from 'express';
import type { Db } from 'mongodb';
import { createModelClient, resolveFromKeys, type ModelClient } from './llm/client';
import { devRouter } from './routes/dev';

export interface AppDeps {
  db: Db;
  // Mounts the development routes, such as POST /dev/replay. Off in production.
  devRoutes: boolean;
  // Where request errors go. The server passes a logger that redacts secrets.
  logError?: (error: unknown) => void;
  // Pipeline messages, such as an update that was not processed again. Redacted by the server.
  log?: (message: string) => void;
  // The model client, built on first use. Without it every model call fails naming its key.
  models?: () => ModelClient;
}

const logMessage = (error: unknown) =>
  console.error(error instanceof Error ? error.message : 'request failed');

const noKeys = () => createModelClient({ resolve: resolveFromKeys({}) });

export function createApp({
  db,
  devRoutes,
  logError = logMessage,
  log = console.log,
  models = noKeys,
}: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');

  app.get('/health', (_req, res) => {
    res.json(HealthResponse.parse({ status: 'ok' }));
  });

  if (devRoutes) app.use(devRouter(db, models, log));

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
