# Interfaces v0

Contracts between modules. T02 and T07 turn them into code. Update this file in the same commit whenever a contract changes.

## MCP tools
All tools are read only. Identity and the allowed tool list come from the run token, never from arguments.

Served by packages/mcp on the official TypeScript SDK v2 (`@modelcontextprotocol/server` and `/client`, pinned to 2.1.0), mounted in the api at POST /mcp. Every input schema is a strict object, so an argument the contract does not name, such as a user id, fails validation. The server registers only the tools the run token lists, so any other tool is missing from tools/list and a call to it fails with "Tool <name> not found". A tool that finds nothing returns a tool error (`isError: true`). Tool output is JSON in `structuredContent`, with the same JSON as text content; times are ISO 8601 strings.

| Tool | Input | Output | Notes |
|---|---|---|---|
| get_my_portfolio | none | holdings with weights | user resolved from the token |
| get_event | eventId | event with its extraction and source ids | see below |
| get_company_relationships | symbol, types? | edges with evidence | reviewed edges only |
| search_news | query, symbols?, since? | ranked news items with source ids | keyword match until T13 makes it hybrid search; see below |
| search_filings | symbol, query | filing chunks with source ids | RAG over FilingChunk; at most 3 chunks per call |
| get_price_reaction | symbol, eventTime | anchor, then stock, SMH and SPY moves per window, delayed flag | see below |

### get_event
- Input: `{ eventId }`, a MarketEvent id.
- Output: `{ eventId, headline, publishedAt, status, extraction, sourceIds }`. extraction is null until extraction has run. The embedding is never returned.
- An unknown id is a tool error.

### search_news
- Input: `{ query, symbols?, since? }`. query is 1 to 200 characters. symbols is 1 to 20 tickers and matches items tagged with any of them. since is an ISO time with an offset; items published at or after it match.
- Thin until T13: news Sources only (kind news; filings are searched with search_filings). The query is split into at most 8 lowercase words, each matched as plain text, case insensitive, in the title or the body. Only the 200 newest matching items are ranked.
- Ranking is deterministic code: the number of distinct words matched, then the newest first, then the source id. At most 10 items.
- Each item: `{ sourceId, eventId, title, url, publishedAt, symbols, tier, excerpt, injectionFlagged, matchedTerms }`.
  - eventId is the MarketEvent whose cluster holds the source, or null.
  - excerpt is the first 500 characters of the untrusted body, or null. It is data for the agent, never instructions.
  - injectionFlagged is the injection screen label, or null when the item has not been screened.

### get_price_reaction
Anchored to the regular session; the Alpaca market calendar defines trading days, opens and closes (weekends, holidays, early closes). SIP bars older than 15 minutes.
- anchor: kind (`headline` when the headline falls inside a regular session, `previous_close` otherwise), baseTime, basePrice, tradingDay (YYYY-MM-DD, ET).
- windows, each with pct and the bar time used, for the symbol, SMH and SPY:
  - `headline` anchor: 15m, 2h, sessionClose.
  - `previous_close` anchor: openGap, 15m after the open, 2h after the open, sessionClose.
  - A window that would end after the session close ends at the close.
- delayed: true.
| get_financial_facts | symbol, metrics | XBRL values with period and source | us-gaap filers only in the MVP |
| search_x_posts | query, since? | posts as Tier 3 signals with links | V2, not in the MVP (X level 1) |

## Run token
Minted by the api for each agent run (mintRunToken in packages/mcp): a JWT signed with HS256 and MCP_TOKEN_SECRET, which must be at least 32 characters.
- sub: user id (a User _id)
- agent: research or verifier (AgentName in packages/shared)
- tools: allowed tool names, at least one, from the MVP tools above (ToolName in packages/mcp)
- iat and exp: exp is exactly 5 minutes after iat, fixed by the minter

Verification accepts HS256 only and rejects any other claim, a lifetime other than 5 minutes and an expired token. Every failure gives the same RunTokenError, which never contains the token.

The MCP server rejects any call to a tool that the token does not list.

The research agent (T08) gets a token with get_event and search_news only. It replaces a token that is 4 minutes old before its next tool call, with the same scope, and records each issue and refresh as a run step.

## Agent runs
AgentRun, AgentStep, Report and Claim in packages/shared, written by code only (apps/api/src/research).
- Every step keeps input, outputSummary and output: the step's JSON output (a string stays as it is), redacted and then capped at 8 KB of UTF-8, with outputTruncated when the cap cut it. Model steps add provider, model and tokens.
- status failed always names failureReason: rate_limited (a 429 asked for a wait over 30 seconds, or a fourth 429), invalid_report (two reports that failed their schema) or error. Any other status has failureReason null.
- Check names are CheckName in packages/shared: quote_verbatim, numbers_match, sources_exist, premises_supported, verifier. A check step's output lists removedClaimIds, the claims that check removed.
- A claim is removed when a check fails; otherwise it is unverified until the verifier (T14) supports it. The report's one section lists kept and removed claims; the screens show removed claims only in the removed block.
- gate is `{ decision, reason }`, written by code (apps/api/src/research/gate.ts). A run the gate or Investigate started has decision run, and its first step, "Gate check", repeats the reason. A run the gate skipped (T12) is stored too: trigger gate, mode auto, status skipped, decision skip, startedAt null, no model or tool step, and one "Gate check" step whose output names the condition (auto_research_off, relevance, importance, active, recent or budget) and the reason. Relevance 0 stores nothing.

## Research gate and daily budget
Code policy only (SPEC.md Pipeline, decision log T12). After each scoring run the api pushes the cards, then decides for every FeedItem above relevance 0, in this order:
- AUTO_RESEARCH is on. The env flag is true or false, on when unset; any other value stops the api at startup. Off, every card above relevance 0 gets a skipped run with condition auto_research_off and the reason "Automatic research is off on this server (AUTO_RESEARCH=false).", no model call and no budget; Investigate is unchanged;
- relevance at least 0.6 (GATE_MIN_RELEVANCE) and the event's importance at least 4 (GATE_MIN_IMPORTANCE);
- the card's research is not queued or running;
- no run for this user and event that was not skipped started in the last 24 hours (RECENT_RUN_MS), whatever its trigger. When that run has a report and the card shows none or failed, the report is attached to the card (done) with no model call;
- the daily budget: research runs per UTC day in the research_budget collection (ResearchBudgetDay in packages/shared), one document per day shared by every machine on the database. Investigate may reserve up to 30 runs a day (DAILY_RUN_LIMIT) and the gate up to 20 (AUTO_RUN_LIMIT), counting both, so at least 10 stay for Investigate. A reservation is one atomic conditional $inc; a skip reserves nothing, and a reserved run stays counted even if it never starts.
A run that passes is queued in auto mode with trigger gate. Investigate skips relevance, importance and the recent run check (Investigate again after done is allowed, decision log T08); it still answers 409 while the card's research is queued or running, and it checks the budget. Both go through one in process queue (apps/api/src/jobs/queue.ts) that runs one research run at a time.

## REST (api)
- GET /health: `{ status: "ok" }`, HealthResponse in packages/shared
- POST /auth/login: body LoginRequest `{ email, password }` (packages/shared; strict, so a user id is rejected). Returns PublicUser (the User without passwordHash and createdAt) and sets the session cookie. A wrong password and an unknown email get the same 401 `{ error: "email or password is wrong" }`; a malformed body gets 400. The persona switcher signs in as a seeded persona with the public demo password.
- POST /auth/logout: clears the session cookie and disconnects that user's sockets; 204.
- GET /me: the signed in user's PublicUser, or 401.
- GET /feed: the signed in user's FeedCard[] with relevance above 0, newest item first (createdAt descending, then _id), at most 50. No cursor yet; the order is stable enough to add one. Relevance 0 items are stored only to mark the event scored for that user (SPEC.md decision log, T05) and never appear in a feed list. 401 without a session.
- GET /events/:eventId/explain: EventExplain in packages/shared, `{ event, source, relevance, path, confidence, evidence }`, for the signed in user. Computed on request by the same code that scores the feed (loadScoringContext and scoreFor in apps/api/src/relevance/feed.ts); it writes nothing, not even a FeedItem. It is how the web shows None for an event no feed list carries. 400 for an id that is not a UUID, 404 for an unknown or unextracted event, 401 without a session.
- POST /events/:eventId/investigate: queues one deep research run (trigger investigate) for the signed in user on the event and answers 202 with that user's FeedCard, research state queued with the new run's id. The research queue runs it (apps/api/src/research/enqueue.ts); the card follows it through feed:update, queued, then running, then done or failed. It skips the relevance, importance and recent conditions of the gate, not the daily budget. 400 for an id that is not a UUID, 401 without a session, 404 when the user has no FeedItem with a path for the event (relevance 0 or unknown), 409 while a run on that item is queued or running, 429 `{ error }` when the day's 30 runs are reserved; a 429 changes nothing. A run whose item stayed queued or running for 15 minutes (for example after an api restart) is taken as lost, and Investigate starts a new one. Investigate again after done or failed starts a new run.
- GET /reports/:reportId: ReportDetail in packages/shared, `{ report, claims, sources, run, card }`, for the signed in user. claims include removed ones; the screens filter on status. sources are ReportSource `{ _id, kind, tier, title, citeLabel, ref }`, built by code for each source a claim cites, without the body text. run is the AgentRun with its steps, as the run screen shows them. card is the user's FeedCard for the event, or null when its FeedItem is gone. 400 for an id that is not a UUID, 401 without a session, 404 for an unknown report or one whose run belongs to another user.
- GET /runs/:runId
- POST /mcp: MCP over stateless Streamable HTTP (see MCP tools), with `Authorization: Bearer <run token>`. A missing, malformed, badly signed or expired token gets 401 with `WWW-Authenticate: Bearer error="invalid_token"` before the SDK sees the request. A malformed JSON body gets 400.
- POST /dev/replay/:sourceId (development only, not mounted in production): sourceId is an Alpaca news id, not a Source._id. Replays the recording `recordings/alpaca/<sourceId>.json` through the pipeline (pre filter, injection screen, extraction, relevance) in replay mode. Returns ReplayResponse in packages/shared, where the ids are the stored Source and MarketEvent:
  - `{ outcome: "processed", sourceId, eventId, sourceCreated, eventCreated }`: the item now has an extraction and a FeedItem for every user. The flags are false when the replay resumed an item stored earlier.
  - `{ outcome: "dropped", reason: "not_in_universe" }`: nothing is stored.
  - `{ outcome: "dropped", reason: "duplicate" | "update", sourceId, eventId }`: the item was already processed (extracted and scored for every user); nothing is extracted or scored again. A second replay of the same item returns duplicate with the same ids.
  - 400 when sourceId is not all digits, 404 when there is no recording, 503 when a needed model key is missing (the body names it) or both model providers are rate limited. After a 503 the item is stored without an extraction and resumes on the next replay.
  - A replay that scores the event pushes the Socket.IO events below.
- POST /dev/reset/:sourceId (development only, not mounted in production): deletes the FeedItems of that Alpaca item's event, for every user, research state included, and nothing else: the Source, the event and its extraction stay. The next replay then scores the event again with no model call and pushes feed:item as a new arrival. Returns ResetResponse `{ sourceId, eventId, deleted }`. 400 when sourceId is not all digits, 404 when the item was never replayed. The web's Replay control calls reset, then replay.

## Auth
Every route except /health, /auth/login, /auth/logout and /mcp, and every socket, takes the user from the session cookie only; no route, query or socket event names a user.
- Cookie `kesher_session`: httpOnly, SameSite=Lax, Path=/, Secure when NODE_ENV is production, 12 hours.
- Its value is an HS256 JWT signed with JWT_SECRET (at least 32 characters, separate from MCP_TOKEN_SECRET), audience `kesher-web`, claims sub (user id), aud, iat and exp only. A run token never passes as a session: it has another secret and no audience.

## FeedCard
The read model for one feed card, FeedCard in packages/shared, assembled on the server from stored documents (assembleCards, feedCard and feedCardsFor in apps/api/src/feed/cards.ts). Nothing in it is written by a model.
- item: the FeedItem. relevance, path and confidence are computed by code. item.research is `{ state, runId, reportId }`, written by code only: none until the gate or Investigate starts a run, queued with the run's id, running, then done with its report or failed. The gate also sets done directly when it attaches a recent run's report. reportId is set exactly when the state is done. `npm run seed` backfills reportId null on items stored before it existed.
- event: the MarketEvent with its extraction, without the embedding.
- source: the event's first Source: _id, provider, kind, tier, externalId, url, publisher, title, publishedAt, injectionScreen. The body text stays on the server; it is untrusted data.
- evidence: one entry per hop of the path whose edge is reviewed, in path order: relationshipId, from, to, type, quote, filingDate, url, reviewed, and the filing (sourceId, filer symbol, title, form, tier). The form is the filer's annual form. A hop without reviewed evidence has no entry. A direct holding has none.
- priceReaction: null until T13.

"Why you" is not a field. Clients render it from item.path with whyYou in packages/shared, the same templates the api uses. Relevance bands come from relevanceBand in packages/shared: high from 0.8, medium above 0, none at 0 (placeholders until T16).

Over JSON and Socket.IO, dates travel as ISO 8601 strings; the client turns them back into dates before parsing with FeedCard.

## Socket.IO events, server to client
The handshake needs the session cookie; without a valid one it fails with `connect_error` "sign in required". Each socket joins its user's room, and closes when the session expires or the user signs out. Only FeedItems with relevance above 0 are pushed as cards (SOCKET_EVENTS in packages/shared).
- feed:item: a FeedCard for a FeedItem that scoring inserted, for its user only
- feed:update: a FeedCard whose FeedItem scoring updated in place, or whose research state changed (queued, running, then done or failed, or done when the gate attached a recent report). A card is pushed before the gate decides on its research. Clients upsert by event, so a card that rose from 0 arrives as an update too.
- event:scored: `{ eventId }` (EventScored), to every signed in socket, after the cards of that scoring run. It carries nothing about any user; a client with no card for the event may ask GET /events/:eventId/explain.
- run:step: a new step in the AgentRun being viewed (T09; not sent yet)
