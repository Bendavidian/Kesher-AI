# State

Updated: 28 Sep 2026, T02 done

## Where we are
T00, T01 and T02 are done. packages/shared holds strict zod schemas for every SPEC.md entity (User, Company, Relationship, Source, MarketEvent, FeedItem, AgentRun, Report, Claim, FilingChunk). Every _id is a string UUID, and a nullable field is used wherever a value can be empty (never optional). Relationships are supplier_of, customer_of and competitor_of. Each needs filing evidence (source id, verbatim quote, filing date, URL, reviewed), and withInverse stores it in both directions. holds comes from User.holdings. Source.injectionScreen stores flagged, a nullable score, the model and the time.

apps/api has the Mongo layer in src/db. It holds typed collections with SCHEMA_BY_COLLECTION, unique indexes on every natural key, and two Atlas vector indexes (market_events and filing_chunks, 384 dimensions, cosine, READY). src/auth/password.ts hashes with scrypt, and src/config/env.ts loads the root .env on demand. `npm run seed` upserts into the Atlas database `kesher`: 4 filing sources (the NVDA, AMD, AVGO and LRCX 10-Ks), the 17 universe companies, the three personas (password kesher-demo, public on purpose) and 6 user reviewed edges, which make 12 documents with their inverses. A second run modifies nothing. Integration tests run on mongod 8.0.32 through mongodb-memory-server-core, which is never Atlas; CI caches that binary. DEMO_SOURCE_ID=38062166 (with DEMO_SOURCE_PROVIDER alpaca) is in apps/api/src/seed/config.ts.

From T01:
- The npm workspaces are apps/web, apps/api, packages/shared and packages/mcp (still a placeholder until T07), on TypeScript 6.0 strict.
- `npm run dev` starts the api on localhost:3001 and the web terminal shell on localhost:5173, which proxies /api.
- The api serves GET /health.
- CI runs typecheck, lint and test on Ubuntu and Windows on every push that touches code.
- T00's results are in docs/SPIKE.md, and its decisions are in the SPEC.md decision log.

Seed quotes are verbatim after spike/checks/01-sec.ts htmlToText (tags stripped, entities decoded, whitespace including NBSP collapsed). T08 and T14 quote checks should apply the same normalization.

## Next
1. T03 replay ingestion: POST /dev/replay/:sourceId, stores the Source and creates the MarketEvent (the unique multikey index on market_events.sourceIds allows one event per source). T03 decides where the Source body text lives, and wires loadEnv and the db into server.ts.
2. On the Windows laptop: pull, run npm install, check Node is at least 22.12 (.nvmrc says 26), and start both servers from .claude/launch.json (it may need npm.cmd instead of npm). The first npm run test downloads mongod 8.0.32 (about 100 MB).
3. Check that CI passes on Ubuntu and Windows with the new mongod cache step.

Keys set in .env: SEC_USER_AGENT, ALPACA_API_KEY_ID, ALPACA_API_SECRET_KEY, FINNHUB_API_KEY, MONGODB_URI, JWT_SECRET, MCP_TOKEN_SECRET, GROQ_API_KEY, GOOGLE_GENERATIVE_AI_API_KEY. Add LIVE_INGEST (see .env.example) on each machine; false on both for now.

## Open decisions
For T11, listed under T11 in BACKLOG.md:
- evidence for Finnhub peer edges, which have no quote;
- whether in_sector and has_theme become edges;
- whether the seed or T11 owns the company fields.
The UI language is settled by docs/UI.md: English interface, with Hebrew summaries as a later option.

## Session log
Newest first. One line per session: date, machine, task, result.
- 28 Sep 2026, macOS (Mac mini), T02: shared domain schemas, Mongo layer, and an idempotent seed with 6 user reviewed 10-K edges; seed run twice on Atlas, the second run modified 0; vector indexes READY; 110 tests green; T02 done.
- 28 Sep 2026, macOS (Mac mini), T01: monorepo scaffold, GET /health, web terminal frame with the UI.md tokens, CI green on Ubuntu and Windows; T01 done.
- 28 Sep 2026, macOS (Mac mini), T00: console numbers and billing recorded, T00 done; model split, pre filter, injection screen and desktop first decided; UI docs approved and added under docs/.
- 28 Sep 2026, macOS (Mac mini), T00: zero budget decisions committed and pushed to GitHub; all seven spike checks pass; findings A to F and the demo item pin decided and recorded; console quotas and Gemini billing confirmation still open.
- 27 Sep 2026, setup: repository created from the starter kit.
