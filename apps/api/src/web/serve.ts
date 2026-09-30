import { existsSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import express, { type RequestHandler } from 'express';

// The web build, from apps/api/src/web.
export const WEB_DIST_DIR = resolve(import.meta.dirname, '../../../web/dist');

// Paths the api keeps at the root in production: the health check (the host's check and the
// keep-alive ping), the agent's own MCP endpoint and Socket.IO.
const ROOT_PATHS = ['/health', '/mcp', '/socket.io'];
const isRootPath = (path: string) =>
  ROOT_PATHS.some((root) => path === root || path.startsWith(`${root}/`));

// Set on a request that came in under /api, so createApi answers an unknown one with JSON.
export interface WebLocals {
  api?: true;
}

// One origin in production (SPEC.md decision log, T18): the api serves the web build and takes
// its own routes under /api, stripped exactly as the Vite dev proxy rewrites them, so the web
// keeps relative /api calls, a same origin cookie and Socket.IO on the page origin. Every other
// GET or HEAD is a static file, or index.html for a client route such as /runs, which must never
// reach the api route of the same name. Mounted before every api route.
export function serveWeb(distDir: string): RequestHandler {
  const indexFile = join(distDir, 'index.html');
  if (!existsSync(indexFile)) {
    throw new Error(`The web build is missing (${indexFile}); run npm run build first`);
  }
  const assetsDir = join(distDir, 'assets') + sep;
  const files = express.static(distDir, {
    index: false,
    // Vite hashes every file under assets/, so they never change under the same name.
    setHeaders: (res, path) => {
      res.setHeader(
        'Cache-Control',
        path.startsWith(assetsDir) ? 'public, max-age=31536000, immutable' : 'no-cache',
      );
    },
  });
  const notFound: RequestHandler = (_req, res) => {
    res.status(404).json({ error: 'not found' });
  };

  return (req, res, next) => {
    if (req.path === '/api' || req.path.startsWith('/api/')) {
      const rest = req.url.slice('/api'.length);
      req.url = rest.startsWith('/') ? rest : `/${rest}`;
      (res.locals as WebLocals).api = true;
      next();
      return;
    }
    if (isRootPath(req.path)) {
      next();
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      notFound(req, res, next);
      return;
    }
    void files(req, res, () => {
      // A missing file keeps its 404; a client route gets the app shell.
      if (extname(req.path)) {
        notFound(req, res, next);
        return;
      }
      res.setHeader('Cache-Control', 'no-cache');
      // Relative to root: send refuses an absolute path with a dot directory in it, such as a
      // checkout under .claude/worktrees.
      res.sendFile('index.html', { root: distDir }, (error) => {
        if (error) next(error);
      });
    });
  };
}
