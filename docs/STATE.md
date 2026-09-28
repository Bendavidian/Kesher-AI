# State

Updated: 28 Sep 2026, T03 done

## Where we are
T00 to T03 are done.

T03 added the first pipeline entry:
- POST /dev/replay/:sourceId takes an Alpaca news id, loads recordings/alpaca/<id>.json, and passes it through ingestItem (apps/api/src/ingest/ingest.ts). This is the one path that T10 live items will use too.
- ingestItem upserts the Source on provider and externalId, then creates one MarketEvent for it. Status is deterministic: confirmed unless the tier is 3. Extraction and embedding stay null until T04.
- The injection screen, extraction and createdAt are written only on insert, so a replay never erases them. A replay returns the same ids with sourceCreated and eventCreated set to false, and E11000 races are retried.
- On Atlas, replaying 38062166 twice left exactly one Source and one MarketEvent.

Source now has text:
- It holds the untrusted item body, normalized with normalizeText in packages/shared. That function is the spike htmlToText with a single entity pass.
- text is null for filings, whose text lives in FilingChunk.
- The seed was rerun on Atlas to backfill text: null on the 4 filing sources. Any other database needs `npm run seed` again.

Recordings are committed JSON files holding the raw provider item without the full article content.
- `npm run record -- --id <id> --symbol <ticker> --date <YYYY-MM-DD>` records one historical Alpaca item. The history endpoint has no id filter, so the recorder searches one symbol and one day and selects by id.
- The demo item 38062166 is recorded, with a summary and author "Benzinga Neuro".

server.ts now loads the root .env and connects to Atlas, then ensures collections and indexes. It mounts dev routes unless NODE_ENV is production, so `npm run dev` now needs MONGODB_URI. createApp takes { db, devRoutes, logError }. redact lives in apps/api/src/config/redact.ts. 144 tests are green.

From T02:
- packages/shared holds strict zod schemas for every SPEC.md entity. Every _id is a string UUID.
- The stored edges are supplier_of, customer_of and competitor_of. Each carries filing evidence and is stored with its inverse.
- The Atlas database `kesher` holds 4 filing sources, the 17 universe companies, the three personas (password kesher-demo) and 12 edge documents.
- Two vector indexes are READY.
- Integration tests run on mongod 8.0.32 through mongodb-memory-server-core, never Atlas.

From T01:
- The workspaces are apps/web, apps/api, packages/shared and packages/mcp (a placeholder until T07), on TypeScript 6.0 strict.
- The web terminal shell runs on localhost:5173 and proxies /api.
- CI runs typecheck, lint and test on Ubuntu and Windows.
- T00's results are in docs/SPIKE.md.

Seed quotes and Source.text use the same normalization, and the T08 and T14 quote checks should compare with normalizeText too.

## Next
1. T04, thin extraction:
   - The pre filter goes into ingestItem. Decide whether a dropped item is still stored as a Source, and where the drop counters live.
   - The injection screen and extraction read Source.text. See the T03 notes in BACKLOG.md.
2. On the Windows laptop:
   - Pull and run npm install. Check that Node is at least 22.12 (.nvmrc says 26).
   - Start both servers from .claude/launch.json; it may need npm.cmd instead of npm.
   - The first npm run test downloads mongod 8.0.32, about 100 MB.
   - Atlas is already reseeded, so no seed run is needed there.
3. Check that CI passes on Ubuntu and Windows.

Keys set in .env: SEC_USER_AGENT, ALPACA_API_KEY_ID, ALPACA_API_SECRET_KEY, FINNHUB_API_KEY, MONGODB_URI, JWT_SECRET, MCP_TOKEN_SECRET, GROQ_API_KEY, GOOGLE_GENERATIVE_AI_API_KEY. Add LIVE_INGEST (see .env.example) on each machine; false on both for now.

## Open decisions
For T11, listed under T11 in BACKLOG.md:
- evidence for Finnhub peer edges, which have no quote;
- whether in_sector and has_theme become edges;
- whether the seed or T11 owns the company fields.
The UI language is settled by docs/UI.md: English interface, with Hebrew summaries as a later option.

## Session log
Newest first. One line per session: date, machine, task, result.
- 28 Sep 2026, macOS (Mac mini), T03: POST /dev/replay/:sourceId through a shared ingestItem, Source.text, committed recordings and npm run record; on Atlas, replaying 38062166 twice left one Source and one MarketEvent; 144 tests green; T03 done.
- 28 Sep 2026, macOS (Mac mini), T02: shared domain schemas, Mongo layer, and an idempotent seed with 6 user reviewed 10-K edges; seed run twice on Atlas, the second run modified 0; vector indexes READY; 110 tests green; T02 done.
- 28 Sep 2026, macOS (Mac mini), T01: monorepo scaffold, GET /health, web terminal frame with the UI.md tokens, CI green on Ubuntu and Windows; T01 done.
- 28 Sep 2026, macOS (Mac mini), T00: console numbers and billing recorded, T00 done; model split, pre filter, injection screen and desktop first decided; UI docs approved and added under docs/.
- 28 Sep 2026, macOS (Mac mini), T00: zero budget decisions committed and pushed to GitHub; all seven spike checks pass; findings A to F and the demo item pin decided and recorded; console quotas and Gemini billing confirmation still open.
- 27 Sep 2026, setup: repository created from the starter kit.
