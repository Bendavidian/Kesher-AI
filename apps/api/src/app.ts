import type { CompanyConceptSource, SearchBackend } from '@kesher/mcp';
import { HealthResponse, type ToolName } from '@kesher/shared';
import express, { type ErrorRequestHandler, type Express } from 'express';
import type { Db } from 'mongodb';
import type { LazyEmbedder } from './embed/event';
import type { ProcessDeps } from './ingest/process';
import { createQueue } from './jobs/queue';
import { autoResearch } from './research/auto';
import type { InvestigateDeps } from './research/investigate';
import type { PriceReactions } from './market/reactions';
import { createModelClient, resolveFromKeys, type ModelClient } from './llm/client';
import { authRouter, type AuthOptions } from './routes/auth';
import { demoRouter, type DemoOptions } from './routes/demo';
import { devRouter } from './routes/dev';
import { feedRouter } from './routes/feed';
import { guestRouter, type GuestOptions } from './routes/guest';
import { mcpRouter } from './routes/mcp';
import { researchRouter } from './routes/research';
import { atlasSearch } from './search/atlas';
import { serveWeb, type WebLocals } from './web/serve';

export interface AppDeps {
  db: Db;
  // Mounts the development routes, such as POST /dev/replay. Off in production.
  devRoutes: boolean;
  // Mounts POST /demo/replay when set, with auth: the reset and replay of the pinned demo item
  // for a signed in user (DEMO_MODE, SPEC.md decision log T18). GET /health reports it.
  demo?: DemoOptions;
  // The web build to serve, with the api's routes under /api (production, SPEC.md decision log
  // T18). Unset in development, where the Vite dev server proxies /api.
  web?: string;
  // Mounts POST /mcp when set. The secret verifies run tokens (MCP_TOKEN_SECRET).
  mcp?: { secret: string };
  // Mounts sign in, GET /me, GET /feed, explain and the guest routes when set. The secret is
  // JWT_SECRET.
  auth?: AuthOptions;
  // The clock and limits of the guest routes (SPEC.md decision log, T24). For tests.
  guest?: GuestOptions;
  // The proxy hops in front of the api, so req.ip is the client's address for the guest rate
  // limit: 1 behind Render's proxy in production, unset in development.
  trustProxy?: number;
  // Gets what each scoring run wrote; the server passes the Socket.IO pushes.
  onScored?: ProcessDeps['onScored'];
  // Where request errors go. The server passes a logger that redacts secrets.
  logError?: (error: unknown) => void;
  // Pipeline messages, such as an update that was not processed again. Redacted by the server.
  log?: (message: string) => void;
  // The model client, built on first use. Without it every model call fails naming its key.
  models?: () => ModelClient;
  // The local embedding model, loaded on first use, for event vectors at extraction. Without it
  // replayed events keep embedding null until npm run embed:events.
  embedder?: LazyEmbedder;
  // Mounts Investigate, GET /reports/:reportId and the run routes when set, with mcp and auth,
  // and runs the research gate after each scoring run. mcpUrl is the api's own POST /mcp, read
  // when a run starts; redact is applied to every run step. autoResearch is AUTO_RESEARCH, on
  // unless set to false: off, the gate records a skip for every card and starts no run;
  // Investigate is unchanged.
  // tools is the run's tool set (researchTools), every research tool when unset.
  research?: {
    mcpUrl: () => string;
    redact: (text: string) => string;
    autoResearch?: boolean;
    tools?: readonly ToolName[];
  };
  // Gets each FeedItem whose research state changed; the server passes the feed:update push.
  onResearch?: InvestigateDeps['onResearch'];
  // Get each stored run step and each run's end; the server passes run:step and run:end.
  onRunStep?: InvestigateDeps['onStep'];
  onRunEnd?: InvestigateDeps['onEnd'];
  // The price reaction over the api's market data (createPriceReactions), for get_price_reaction
  // and FeedCard.priceReaction. Without it cards carry null and the tool answers unavailable.
  priceReactions?: PriceReactions;
  // The searches behind search_filings and search_news. Atlas over db and the embedder when
  // unset; tests pass an in memory backend, since plain mongod has no search stages.
  search?: SearchBackend;
  // SEC XBRL values for get_financial_facts (sec/xbrl.ts). Without it the tool answers that SEC
  // data is unavailable.
  companyConcept?: CompanyConceptSource;
}

// The Express app, and what runs after each scoring run: the Socket.IO pushes, then the research
// gate when research is mounted. Replay and live ingestion both take afterScoring, so a live card
// gets the same pushes and automatic research as a replayed one.
export interface Api {
  app: Express;
  afterScoring: ProcessDeps['onScored'];
  // Resolves once every research job queued so far has run. For tests.
  idle: () => Promise<void>;
}

const logMessage = (error: unknown) =>
  console.error(error instanceof Error ? error.message : 'request failed');

const noKeys = () => createModelClient({ resolve: resolveFromKeys({}) });

export function createApp(deps: AppDeps): Express {
  return createApi(deps).app;
}

export function createApi({
  db,
  devRoutes,
  demo,
  web,
  mcp,
  auth,
  guest,
  trustProxy,
  onScored,
  logError = logMessage,
  log = console.log,
  models = noKeys,
  embedder,
  research,
  onResearch,
  onRunStep,
  onRunEnd,
  priceReactions,
  search,
  companyConcept,
}: AppDeps): Api {
  const app = express();
  app.disable('x-powered-by');
  if (trustProxy !== undefined) app.set('trust proxy', trustProxy);
  if (web) app.use(serveWeb(web));

  const demoMode = Boolean(demo && auth);
  app.get('/health', (_req, res) => {
    res.json(HealthResponse.parse({ status: 'ok', demoMode }));
  });

  // After a scoring run: the cards go out first, then the gate decides on research, so a card
  // never waits for it (SPEC.md Pipeline).
  let afterScoring = onScored;
  // One queue for automatic runs and Investigate: one research run at a time.
  const queue = createQueue({ logError });

  if (mcp) {
    app.use(
      mcpRouter(db, mcp.secret, {
        onError: logError,
        search: search ?? atlasSearch(db, embedder),
        ...(priceReactions ? { priceReaction: priceReactions } : {}),
        ...(companyConcept ? { companyConcept } : {}),
      }),
    );
  }
  if (auth) {
    app.use(authRouter(db, auth));
    app.use(guestRouter(db, auth, guest));
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
        ...(research.tools ? { tools: research.tools } : {}),
        // numbers_match reads the same price reaction the cards and get_price_reaction use.
        ...(priceReactions ? { priceReactions } : {}),
        queue,
        logError,
        ...(onResearch ? { onResearch } : {}),
        ...(onRunStep ? { onStep: onRunStep } : {}),
        ...(onRunEnd ? { onEnd: onRunEnd } : {}),
      };
      app.use(researchRouter(deps, auth.secret, market));
      // A push that fails is logged; the gate still decides, since the event counts as scored
      // and is not scored again.
      afterScoring = async (eventId, scored) => {
        try {
          await onScored?.(eventId, scored);
        } catch (error) {
          logError(error);
        }
        await autoResearch(deps, eventId, scored, { enabled: research.autoResearch ?? true });
      };
    }
  }
  if (demo && auth) {
    app.use(
      demoRouter(
        db,
        auth.secret,
        {
          models,
          log,
          ...(afterScoring ? { onScored: afterScoring } : {}),
          ...(embedder ? { embedder } : {}),
        },
        demo,
      ),
    );
  }
  if (devRoutes) app.use(devRouter(db, models, log, afterScoring, embedder));
  // With the web served, an unknown path under /api answers JSON, never the app shell.
  if (web) {
    app.use((_req, res, next) => {
      if (!(res.locals as WebLocals).api) {
        next();
        return;
      }
      res.status(404).json({ error: 'not found' });
    });
  }

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

  return { app, afterScoring, idle: () => queue.idle() };
}
