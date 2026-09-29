# State

Updated: 29 Sep 2026, T08 done (part 2)

## Where we are
T00 to T08 are done. T08 part 2 wired Investigate to the research agent from part 1, now that T06 gives every route a signed in user:
- POST /events/:eventId/investigate (apps/api/src/routes/research.ts, apps/api/src/research/investigate.ts):
  - The user comes from the session cookie only.
  - One conditional write moves the user's FeedItem to research running, with a new run id, and the route answers 202 with that card. Two requests never start two runs: the second gets 409.
  - 404 when the user has no FeedItem with a path for the event (relevance 0 or unknown); 400 for a bad id; 401 without a session.
  - runResearch (deep, trigger investigate) runs in the background as a promise in the api process. It now takes an optional runId, so the card names its run from the start.
  - When the run ends, the item becomes done with its reportId, or failed. Each change is pushed as feed:update by realtime.publishItem. A failed push is logged and never stops the run; the final write is retried once and only replaces this run's state, so a dev reset or a newer run is left alone.
  - Investigate again is allowed after done or failed. A run left running for 15 minutes (STALE_RESEARCH_MS), for example after an api restart, is taken over by the next Investigate. There is no startup recovery, because two machines may share one database; the lost AgentRun stays in status running.
- GET /reports/:reportId returns ReportDetail `{ report, claims, sources, run, card }` for the report's own user and 404 for anyone else.
  - sources are ReportSource labels built by code (Benzinga via Alpaca, Benzinga headline, id 38062166), without the body text.
  - run keeps its steps, as the run screen shows them.
- packages/shared:
  - FeedItem.research is `{ state, runId, reportId }`, with reportId present exactly when done, and NO_RESEARCH.
  - New ReportSource and ReportDetail.
  - `npm run seed` backfills research.reportId null on older FeedItems (backfillResearchReports); it set 3 on Atlas. Any other database needs `npm run seed` once, or GET /feed fails on the strict schema.
- server.ts passes the api's own http://127.0.0.1:<port>/mcp as the research MCP URL, and redact now masks the model keys too.
- Web:
  - ScoresPanel shows Investigate, then "Investigating…" with a status line. Once done it offers "Open research report" (link to /reports/:reportId) and "Investigate again"; a failed run gets a failure line. POST errors show under the button.
  - View agent run stays disabled until T09.
  - FeedScreen applies the 202 card through useLiveFeed's upsert, which drops a card from a persona the user switched away from.
  - ReportScreen reads api.report and api.me (new) instead of fixtures. decodeReport keeps AgentStep.input as sent, because reviveDates had turned ISO strings in step inputs into Dates. ReportSourceView is now the shared ReportSource.
- The report screen counts as removed only claims with status removed. An inference whose premises are not supported yet stays hidden with a neutral line ("1 inference waits for verification"), and so does a claim whose source cannot be listed. Until T14, every inference waits.
- On Atlas, persona A, Investigate on the TSMC card:
  - The run was get_event, then search_news, then a report: 1,383, 1,679 and 2,289 tokens, 5,351 of 20,000, on gemini-3.5-flash-lite.
  - Two facts, each citing the Benzinga source with sources_exist and quote_verbatim passed, and one inference waiting for verification.
  - The card went from running to done, and the report screen rendered from the api at 1440px and 1279px.
- The reviewer found no blockers; its points on push failures, the settle retry and stale comments were fixed.
- 496 tests are green.

T08 part 1 added the research agent in apps/api/src/research, with no route yet:
- runResearch (agent.ts) loads the user's FeedItem path and holdings, picks one provider for the run (pickRunProvider), and mints a run token through openToolbox (mcp.ts) with get_event and search_news only. It connects as a real MCP client to POST /mcp and replaces the token before a call once it is 4 minutes old; every issue and refresh is a code step with the same scope. The user id goes into the token only, never into a prompt or a tool argument. The brief holds only code written text (the "Why you" line from whyYou, held symbols, the budget); the untrusted headline arrives through get_event.
- The loop is code: one model call per turn through runStep in the model client, with the MCP tools plus a local submit_report tool whose input is the claim draft (draft.ts, zod). The model executes nothing; code runs each tool call, and tool output returns inside <tool_output> tags. A tool name the token does not list never reaches MCP.
- Budgets (budget.ts): tool calls 6 in auto and 15 in deep; tokens 12,000 in auto and 20,000 in deep, replacing 6,000 (SPEC.md decision log). planTurn starts a tool turn only when a worst case report can still follow it, keeping 1,500 tokens for the report; otherwise code forces submit_report, and with no room for even a minimal report the run ends budget_exhausted. A report failing its schema, or a report turn without one, gets one more try, then failed invalid_report.
- 429 inside a run: runStep waits on the same provider, honoring retry-after or Gemini's retryDelay up to 30 seconds per wait, at most 3 retries; otherwise the run ends failed with failureReason rate_limited, recorded as a step, and no report. Single calls keep the T04 behavior (retry-after header only).
- Every step is written to the AgentRun as it happens (`$push`), its output redacted and then capped at 8 KB of UTF-8 (output.ts). packages/shared gained AgentStep output and outputTruncated, AgentRun.failureReason (set exactly when failed), CheckName and utf8Length.
- Claim checks (checks.ts), code only: sources_exist (a source a tool returned in this run) and quote_verbatim (at least 20 characters, found after normalizeText in the source's title or text). A failing claim is removed, a passing one stays unverified until T14; an inference whose premise was removed is removed. Check steps list removedClaimIds. Claims are written, then one Report with a single "Claims" section; a failed report insert removes its claims.
- `npm run research:dev -- [--mode deep|auto] [--record] [--force]` runs persona A on the demo event against Atlas through an in process MCP server on 127.0.0.1 and prints the run. It refuses production and nothing imports it.
- On Atlas, deep mode: get_event, then search_news (1 item), then the model submitted on its own. Turns 1,383, 1,679 and 2,279 tokens, 5,341 of 20,000; two facts and an inference, none removed. Recorded to recordings/research/38062166.json and replayed in replay.integration.test.ts with no provider call. Auto mode at 8,000 made one tool call before code forced the report (3,157 tokens); at 12,000 it made two and submitted on its own at 5,317, with a third call allowed by the plan. Atlas holds only one news item, so search has little to find.
- 463 tests are green after rebasing on T06.

T06, merged in PR 8 (summary from the PR; its session left STATE and the BACKLOG mark to this wrap):
- Sign in: POST /auth/login, POST /auth/logout and GET /me. The session is an HS256 JWT in the httpOnly SameSite=Lax cookie kesher_session, signed with JWT_SECRET, which is separate from the run token secret. Every route and the socket handshake take the user from the cookie only (currentUser in apps/api/src/auth/session.ts).
- GET /feed returns FeedCards with relevance above 0. GET /events/:eventId/explain computes the user's relevance and path on request and writes nothing; persona C's None comes from it.
- Socket.IO pushes feed:item and feed:update to the user's room, only above relevance 0, and event:scored to every signed in socket. processItem has an onScored hook.
- POST /dev/reset/:sourceId (development only) deletes the event's FeedItems, so the web's Replay control can replay the demo again with no model call.
- Proof: three socket sessions in a test, and three browser sessions against Atlas: A High 0.80, B High 1.00, C None 0.00.

T05 added propagation and relevance after extraction. processItem now runs pre filter, injection screen, extraction, then scoreEvent (apps/api/src/relevance):
- loadEdges: one $graphLookup per event from the start companies, maxDepth 1 (2 hops), reviewed edges only.
- Start nodes are the extracted companies that the provider also tagged (Source.symbols) and that are universe companies. An article tagged KO whose text names NVDA never reaches NVDA holders. The full extraction stays stored.
- bestPath (pure): direct 1, one hop the edge weight, two hops w1·w2·0.7, maximum over paths, no revisits. Ties go to fewer hops, then event company, holding and edge ids.
- confidenceFor: high with a Tier 1 source or two Tier 2 sources with different publishers, medium with one Tier 2, low otherwise.
- One FeedItem per user, relevance 0 included. An event counts as processed once it has an extraction and a FeedItem for every user, so a partial scoring run resumes with no model call. This differs from design point 1 and is logged in SPEC.md with its limit (one document per user per event; a scoredAt marker replaces it at scale). The feed must still hide relevance 0; see the T06 notes.
- FeedCard in packages/shared, assembled by assembleCards, feedCard and feedCardsFor (apps/api/src/feed/cards.ts): the FeedItem, the event without its embedding, the source without its text, reviewed evidence per hop with the filing and its form, and priceReaction null. GET /feed and the socket events land in T06 with login.
- Source.publisher (Benzinga for Alpaca news, null for filings). `npm run seed` backfills it on older Sources (backfillPublishers).
- whyYou, SHORT_NAME, HOP_VERB, joinList and relevanceBand (high from 0.8, medium above 0, none at 0) moved to packages/shared; the web uses them with unchanged wording.

On Atlas the seed backfilled publisher on 5 sources. Replaying 38062166 resumed the extracted event into scoring with the same ids: A 0.8 through TSM supplier_of NVDA, B 1 direct, C 0, all medium. A's card shows Benzinga and the NVIDIA 10-K quote. A second replay returned duplicate (replay/duplicate 2). 347 tests are green.

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
- An item counts as processed once its event has an extraction (since T05, also a FeedItem for every user). Sent again unchanged it is a duplicate; with changed provider fields it is an update, logged with field names only. Neither calls a model. ingestItem is now insert only, so the stored text always matches its screen and extraction.
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
1. Check that CI passes on Ubuntu and Windows for the PR "T08: Investigate route, button and report", then merge it.
2. T09 Agent Runs view. Read the notes from T08 part 2 under T08 in BACKLOG.md:
   - GET /runs/:runId and the run list for the signed in user; decode steps as decodeReport does, keeping AgentStep.input as sent;
   - the run screen shows AgentStep.output instead of DEMO_STEP_OUTPUTS, and the Agent runs tab uses the run list;
   - enable View agent run on the card (research.runId is set from the start; the AgentRun appears a moment later) and point the report screen's run links at real runs;
   - run:step for the run being viewed; the UI track notes under T08 (shared AgentName and ToolName on the web, served free tier limits).
3. On the Windows laptop:
   - Pull and run npm install. Check that Node is at least 22.12 (.nvmrc says 26).
   - Start both servers from .claude/launch.json; it may need npm.cmd instead of npm.
   - The first npm run test downloads mongod 8.0.32, about 100 MB.
   - That machine's .env needs GROQ_API_KEY and GOOGLE_GENERATIVE_AI_API_KEY for replay, Investigate and research:dev, MCP_TOKEN_SECRET and JWT_SECRET of at least 32 characters each, or the api does not start.
   - Run `npm run seed` once if that machine uses its own database, so older Sources get publisher and older FeedItems get research.reportId.

Keys set in .env: SEC_USER_AGENT, ALPACA_API_KEY_ID, ALPACA_API_SECRET_KEY, FINNHUB_API_KEY, MONGODB_URI, JWT_SECRET, MCP_TOKEN_SECRET, GROQ_API_KEY, GOOGLE_GENERATIVE_AI_API_KEY. Add LIVE_INGEST (see .env.example) on each machine; false on both for now.

## Open decisions
For T11, listed under T11 in BACKLOG.md:
- evidence for Finnhub peer edges, which have no quote;
- whether in_sector and has_theme become edges;
- whether the seed or T11 owns the company fields.
The UI language is settled by docs/UI.md: English interface, with Hebrew summaries as a later option.

## Session log
Newest first. One line per session: date, machine, task, result.
- 29 Sep 2026, macOS (Mac mini), T08 part 2: POST /events/:eventId/investigate answers 202 and runs deep research in the background with the user from the session, one run per item (409), stale takeover after 15 minutes; GET /reports/:reportId with ReportSource labels; FeedItem.research.reportId with a seed backfill; Investigate button states and the report screen on the api; only removed claims count as removed, waiting inferences get a neutral line; one real run on Atlas gave two facts with verified quotes; reviewer found no blockers; 496 tests green; T08 done.
- 29 Sep 2026, macOS (Mac mini), T08 part 1: T08 split in two under one id; research agent over MCP with scoped run tokens and refresh, code planned turns and budgets (12,000 auto, 20,000 deep), the in-run 429 policy, steps written as they happen with 8 KB redacted output, quote checks that remove or keep claims unverified, research:dev; one real Gemini run on Atlas recorded and replayed; reviewer found no blockers; rebased on T06, 463 tests green; T06 marked done from PR 8; T08 stays [~].
- 29 Sep 2026, macOS (Mac mini), T06: cookie sign in with the persona switcher, GET /feed above 0, explain on request for None, Socket.IO pushes with event:scored, dev reset plus replay; one Replay updated three browser sessions to A 0.80, B 1.00, C None on Atlas; reviewer found no blockers and the socket closes on logout and expiry; 405 tests green, CI green on PR 8; STATE and the BACKLOG mark came with the T08 part 1 wrap.
- 28 Sep 2026, macOS (Mac mini), T05: $graphLookup propagation, relevance, confidence and one FeedItem per user after extraction; start nodes limited to provider tagged companies; FeedCard read model and assembler; Source.publisher with a seed backfill; Why you templates and bands in shared; rebased on T07 and the UI track part 2; on Atlas the demo event scored A 0.8, B 1, C 0 and a second replay was a duplicate; 347 tests green; T05 done.
- 28 Sep 2026, macOS (Mac mini), T07: packages/mcp on MCP SDK v2 with get_event and a thin search_news, HS256 run tokens with user and tool scopes, POST /mcp in the api; a token without search_news is rejected and no tool accepts a user id, proven in memory and over HTTP; checked against Atlas; rebased on T04; 262 tests green; T07 done.
- 28 Sep 2026, macOS (Mac mini), T04: pre filter with ingest_counters, injection screen that fails open to null, extraction on Groq with a per call Gemini fallback and a limiter, processItem behind replay; on Atlas the demo item extracted TSM, importance 4, and a second replay counted a duplicate; 205 tests green; T04 done.
- 28 Sep 2026, macOS (Mac mini), T03: POST /dev/replay/:sourceId through a shared ingestItem, Source.text, committed recordings and npm run record; on Atlas, replaying 38062166 twice left one Source and one MarketEvent; 144 tests green; T03 done.
- 28 Sep 2026, macOS (Mac mini), T02: shared domain schemas, Mongo layer, and an idempotent seed with 6 user reviewed 10-K edges; seed run twice on Atlas, the second run modified 0; vector indexes READY; 110 tests green; T02 done.
- 28 Sep 2026, macOS (Mac mini), T01: monorepo scaffold, GET /health, web terminal frame with the UI.md tokens, CI green on Ubuntu and Windows; T01 done.
- 28 Sep 2026, macOS (Mac mini), T00: console numbers and billing recorded, T00 done; model split, pre filter, injection screen and desktop first decided; UI docs approved and added under docs/.
- 28 Sep 2026, macOS (Mac mini), T00: zero budget decisions committed and pushed to GitHub; all seven spike checks pass; findings A to F and the demo item pin decided and recorded; console quotas and Gemini billing confirmation still open.
- 27 Sep 2026, setup: repository created from the starter kit.
