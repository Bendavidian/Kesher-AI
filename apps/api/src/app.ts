import { HealthResponse } from '@kesher/shared';
import express, { type Express } from 'express';

export function createApp(): Express {
  const app = express();
  app.disable('x-powered-by');

  app.get('/health', (_req, res) => {
    res.json(HealthResponse.parse({ status: 'ok' }));
  });

  return app;
}
