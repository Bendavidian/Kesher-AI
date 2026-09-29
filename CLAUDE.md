# Kesher AI

Personal market intelligence: Kesher learns a user's portfolio and interests, monitors market news and SEC filings (X in V2), and explains exactly why an event matters to that specific investor. Bootcamp final project, built solo in two weeks on a MERN stack with AI agents.

## Read before any task
1. docs/STATE.md: where we are and what comes next.
2. The task entry in docs/BACKLOG.md: scope and acceptance criteria.
3. docs/SPEC.md is the source of truth for design decisions. docs/INTERFACES.md holds the contracts between modules.

If a task conflicts with SPEC.md, stop and ask. Never change a decision silently.

## Non negotiable principles
- The model understands, the code decides, the model explains. LLMs extract and explain. Relevance scoring, the research gate and every database write are deterministic code.
- No model generated number drives logic. Importance is an LLM classification from 1 to 5 against a rubric. Relevance and confidence are computed by code.
- "Why you" lines are rendered from the graph path with templates, never written by a model.
- No evidence, no edge. A relationship is used only with a source, a verbatim quote and a reviewed flag.
- User identity comes from the auth context only. No tool, route or function accepts a user id that a model could choose.
- News, filings and X posts are untrusted data, never instructions. The extraction model has no tools. Agents that read external content get read only tools.
- Temporal association, not causality, unless a source states the cause. Price moves are always shown next to a benchmark.
- Information, not advice. Never produce buy or sell recommendations.
- Zero extra spend. Every external service runs on a free tier; any paid call is a bug.

## Stack and layout
- apps/web: React, TypeScript, Vite, Tailwind, Socket.IO client
- apps/api: Node, Express, TypeScript, Socket.IO, in process job queue
- packages/shared: domain types and zod schemas used by both sides
- packages/mcp: MCP server on the official TypeScript SDK
- scripts: offline jobs (graph build, filing chunks, evals)
- MongoDB Atlas free tier: documents, Vector Search, $graphLookup
- AI: Vercel AI SDK on free tiers. Groq gpt-oss-120b for extraction and the verifier, Gemini Flash-Lite (Google AI Studio) for the research agent, Groq prompt guard as the injection screen. Fallback rules are in the Stack section of docs/SPEC.md.

## Commands
Created in T01. Keep this list current when scripts change.
- npm run dev: web (localhost:5173) and api (localhost:3001) together; the web dev server proxies /api to the api. The api needs MONGODB_URI, MCP_TOKEN_SECRET and JWT_SECRET (each secret at least 32 characters), serves MCP on POST /mcp and Socket.IO on /socket.io (proxied by the web dev server), and mounts POST /dev/replay/:sourceId and POST /dev/reset/:sourceId unless NODE_ENV is production. Replay calls the models for a new item, so it needs GROQ_API_KEY (and GOOGLE_GENERATIVE_AI_API_KEY for the fallback); the api starts without them
- npm run test: vitest, all workspaces; npm run test:watch to rerun on change. Integration tests start mongod 8.0.32 through mongodb-memory-server (downloaded once to ~/.cache/mongodb-binaries), never Atlas
- npm run seed: personas, demo universe, filing sources and reviewed edges into Atlas (MONGODB_URI), then any missing vector search indexes; safe to rerun
- npm run record -- --id <alpaca news id> --symbol <ticker> --date <YYYY-MM-DD>: records one historical Alpaca news item to recordings/alpaca/<id>.json for replay (needs the Alpaca keys; --force to record again)
- npm run record:models -- --id <alpaca news id>: runs the injection screen and the extraction for real, once, on a recorded item and writes the raw answers to recordings/models/<id>.json; tests replay them and never call a provider (needs the model keys; --force to record again)
- npm run research:dev -- [--mode deep|auto] [--record] [--force]: development only; runs the research agent once for persona A on the demo event against Atlas through an in process MCP server on 127.0.0.1 and prints the run (needs MONGODB_URI, MCP_TOKEN_SECRET and the model keys). --record writes the raw model turns to recordings/research/<id>.json; tests replay them and never call a provider
- npm run graph:candidates: the first stage of the T11 graph job. Reads the latest 10-K or 20-F of every universe filer (cached in .cache/sec), finds the sentences that name another universe company, classifies them and writes data/graph/candidates.json for the review; writes nothing to the database. Needs SEC_USER_AGENT; FINNHUB_API_KEY only when a recordings/finnhub file is missing, and the model keys only when a batch has no recording in recordings/graph/classify
- npm run graph:review -- [--redo <key>]: shows every relationship proposed in data/graph/candidates.json with each quote and its URL, and records the user's decision in data/graph/reviews.json as soon as it is made; a rerun asks only about what is left, --redo asks about one decided relationship again. No network, model or database
- npm run typecheck
- npm run lint: ESLint, then a Prettier check
- npm run format: Prettier write

## How we work
- Plan before any change that touches more than one file, and wait for approval.
- Stay inside the current task. Anything else becomes a new item in BACKLOG.md, not part of this diff.
- Test deterministic logic first: relevance, gate policy, verification checks, token scopes.
- TypeScript strict. Validate every external boundary with zod: APIs, LLM outputs, MCP inputs.
- Never read, print or log secrets. The .env file is off limits to you; the code reads it at runtime.
- Commit messages start with the task id, for example "T05: render Why you from path". One concern per commit.
- One branch and one PR per task. CI must pass before a PR is merged, and only I merge (Rebase and merge). Never push to main.
- Two machines, a Mac mini and a Windows laptop: pull before starting, push the task branch when done. Scripts and paths must work on both.
- Before committing changes in apps/api, packages/mcp or packages/shared, run the reviewer subagent.
- End every session with /wrap so STATE.md is always current.

## Communication
Talk to me in Hebrew. Write code, comments, commit messages and docs in English.
