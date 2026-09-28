import { HealthResponse } from '@kesher/shared';
import express, { type ErrorRequestHandler, type Express } from 'express';
import type { Db } from 'mongodb';
import { devRouter } from './routes/dev';

export interface AppDeps {
  db: Db;
  // Mounts the development routes, such as POST /dev/replay. Off in production.
  devRoutes: boolean;
  // Where request errors go. The server passes a logger that redacts secrets.
  logError?: (error: unknown) => void;
}

const logMessage = (error: unknown) =>
  console.error(error instanceof Error ? error.message : 'request failed');

export function createApp({ db, devRoutes, logError = logMessage }: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');

  app.get('/health', (_req, res) => {
    res.json(HealthResponse.parse({ status: 'ok' }));
  });

  if (devRoutes) app.use(devRouter(db));

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
