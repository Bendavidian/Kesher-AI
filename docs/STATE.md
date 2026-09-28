# State

Updated: 28 Sep 2026, T07 done

## Where we are
T00 to T04 and T07 are done. T05 and T06 are still open; T07 did not depend on them.

T07 added the MCP server in packages/mcp, on the official TypeScript SDK v2 pinned at 2.1.0 (`@modelcontextprotocol/server`, and `/client` for tests and T08):
- Run token (token.ts): an HS256 JWT signed with MCP_TOKEN_SECRET, which must be at least 32 characters. Claims are sub (user id), agent (AgentName, now in shared), tools (ToolName) and a fixed 5 minute lifetime. mintRunToken is ready for T08. verifyRunToken accepts HS256 only, validates the claims with zod and fails with one RunTokenError that never contains the token.
- The api mounts POST /mcp: stateless Streamable HTTP, `Authorization: Bearer <run token>`, 401 before the SDK for a bad token and 400 for malformed JSON. apps/api/src/routes/mcp.ts bridges Express to the SDK's fetch handler (createMcpFetch).
- Each request gets a fresh server that registers only the tools its token lists (createKesherServer), and each handler checks the scope again. Input schemas are strict, so a userId argument fails validation.
- get_event returns the event with its extraction and source ids, never the embedding.
- search_news is thin: keyword match over news Sources with symbols and since filters, ranked by code on distinct words matched and then recency, at most 10 items with the linked eventId and a 500 character excerpt. T13 makes it hybrid.
- The api does not start without MCP_TOKEN_SECRET; the redactor masks it.
- Over HTTP on the dev api with Atlas, a token with only get_event returned the demo event and had search_news rejected; a full token found the demo headline linked to its event. 262 tests are green.

T04 added the pipeline in front of relevance. Every item enters through processItem (apps/api/src/ingest/process.ts), in SPEC.md order:
- Pre filter, code only. An item passes only when its provider symbols include a demo universe company; SPY and SMH alone and items with no symbols are dropped. A dropped item is not stored at all.
- An item counts as processed once its event has an extraction. Sent again unchanged it is a duplicate; with changed provider fields it is an update, logged with field names only. Neither calls a model. ingestItem is now insert only, so the stored text always matches its screen and extraction.
- Drops are counted in the new ingest_counters collection, one document per UTC day, mode (live or replay) and reason.
- Injection screen: Groq prompt guard over chunks of at most 1,200 characters, highest score, flagged at 0.5 (FLAG_THRESHOLD). It fails open: a screen that does not finish leaves injectionScreen null, never flagged: false, and extraction still runs.
- Extraction: one structured call on Groq openai/gpt-oss-120b with low reasoning effort and no tools, the item quoted inside <article>. Code keeps only valid tickers.
- A step that already ran is skipped, so an item whose extraction failed resumes on the next replay.

The model client is apps/api/src/llm/client.ts:
- A sliding window limiter per provider and model, with the console limits from SPIKE.md. A 429 releases its reservation and blocks that model until retry-after.
- generateSingle falls back to Gemini gemini-3.5-flash-lite per call on a 429.
- pickRunProvider(budgetTokens) is ready for T08.
- Keys are read lazily. The api starts without GROQ_API_KEY and GOOGLE_GENERATIVE_AI_API_KEY; replay answers 503 naming a missing key only when a model is needed.

POST /dev/replay/:sourceId now returns ReplayResponse as a processed or dropped outcome (INTERFACES.md).

Tests never call a provider. `npm run record:models -- --id <id>` records the real answers once to recordings/models/<id>.json, and tests replay them through mock models from ai/test. The demo item's recording gives TSM, negative, natural_disaster, importance 4, at 846 tokens.

On Atlas, replaying 38062166 resumed the T03 Source. It stored injectionScreen flagged false (score 0.0004) and an extraction of TSM negative with importance 4. A second replay returned duplicate with the same ids, and ingest_counters shows replay/duplicate 1.

Work happens on a branch per task. The branch is pushed and a PR opened to main titled with the task id; the user merges it after CI passes. Never push to main.

From T03:
- POST /dev/replay/:sourceId loads recordings/alpaca/<id>.json by Alpaca id; `npm run record` records an item by searching one symbol and one day and selecting by id.
- Source.text holds the untrusted body, normalized with normalizeText, and is null for filings. The seed was rerun on Atlas to backfill it; any other database needs `npm run seed` again.
- server.ts loads the root .env, connects to Atlas and ensures collections and indexes; redact lives in apps/api/src/config/redact.ts.

From T02:
- packages/shared holds strict zod schemas for every SPEC.md entity. Every _id is a string UUID.
- The stored edges are supplier_of, customer_of and competitor_of. Each carries filing evidence and is stored with its inverse.
- The Atlas database `kesher` holds 4 filing sources, the 17 universe companies, the three personas (password kesher-demo) and 12 edge documents.
- Two vector indexes are READY.
- Integration tests run on mongod 8.0.32 through mongodb-memory-server-core, never Atlas.

From T01:
- The workspaces are apps/web, apps/api, packages/shared and packages/mcp (filled in T07), on TypeScript 6.0 strict.
- The web terminal shell runs on localhost:5173 and proxies /api.
- CI runs typecheck, lint and test on Ubuntu and Windows.
- T00's results are in docs/SPIKE.md.

Seed quotes and Source.text use the same normalization, and the T08 and T14 quote checks should compare with normalizeText too.

## Next
1. T05, relevance, thin. BACKLOG.md T05 now carries the UI track notes:
   - a FeedCard read model in shared, with GET /feed and the socket events carrying it;
   - Source.publisher;
   - the "Why you" templates moved into shared;
   - placeholder relevance bands.
   The extraction on the demo event is ready on Atlas.
2. On the Windows laptop:
   - Pull and run npm install. Check that Node is at least 22.12 (.nvmrc says 26).
   - Start both servers from .claude/launch.json; it may need npm.cmd instead of npm.
   - The first npm run test downloads mongod 8.0.32, about 100 MB.
   - Replay needs GROQ_API_KEY in that machine's .env.
   - The api now needs MCP_TOKEN_SECRET of at least 32 characters in that machine's .env, or it does not start.
3. Check that CI passes on Ubuntu and Windows for the T07 PR.
4. T08 then builds on T07: the api mints a run token per run with mintRunToken and connects the SDK client to POST /mcp (see the T07 notes in BACKLOG.md).

Keys set in .env: SEC_USER_AGENT, ALPACA_API_KEY_ID, ALPACA_API_SECRET_KEY, FINNHUB_API_KEY, MONGODB_URI, JWT_SECRET, MCP_TOKEN_SECRET, GROQ_API_KEY, GOOGLE_GENERATIVE_AI_API_KEY. Add LIVE_INGEST (see .env.example) on each machine; false on both for now.

## Open decisions
For T11, listed under T11 in BACKLOG.md:
- evidence for Finnhub peer edges, which have no quote;
- whether in_sector and has_theme become edges;
- whether the seed or T11 owns the company fields.
The UI language is settled by docs/UI.md: English interface, with Hebrew summaries as a later option.

## Session log
Newest first. One line per session: date, machine, task, result.
- 28 Sep 2026, macOS (Mac mini), T07: packages/mcp on MCP SDK v2 with get_event and a thin search_news, HS256 run tokens with user and tool scopes, POST /mcp in the api; a token without search_news is rejected and no tool accepts a user id, proven in memory and over HTTP; checked against Atlas; rebased on T04; 262 tests green; T07 done.
- 28 Sep 2026, macOS (Mac mini), T04: pre filter with ingest_counters, injection screen that fails open to null, extraction on Groq with a per call Gemini fallback and a limiter, processItem behind replay; on Atlas the demo item extracted TSM, importance 4, and a second replay counted a duplicate; 205 tests green; T04 done.
- 28 Sep 2026, macOS (Mac mini), T03: POST /dev/replay/:sourceId through a shared ingestItem, Source.text, committed recordings and npm run record; on Atlas, replaying 38062166 twice left one Source and one MarketEvent; 144 tests green; T03 done.
- 28 Sep 2026, macOS (Mac mini), T02: shared domain schemas, Mongo layer, and an idempotent seed with 6 user reviewed 10-K edges; seed run twice on Atlas, the second run modified 0; vector indexes READY; 110 tests green; T02 done.
- 28 Sep 2026, macOS (Mac mini), T01: monorepo scaffold, GET /health, web terminal frame with the UI.md tokens, CI green on Ubuntu and Windows; T01 done.
- 28 Sep 2026, macOS (Mac mini), T00: console numbers and billing recorded, T00 done; model split, pre filter, injection screen and desktop first decided; UI docs approved and added under docs/.
- 28 Sep 2026, macOS (Mac mini), T00: zero budget decisions committed and pushed to GitHub; all seven spike checks pass; findings A to F and the demo item pin decided and recorded; console quotas and Gemini billing confirmation still open.
- 27 Sep 2026, setup: repository created from the starter kit.
