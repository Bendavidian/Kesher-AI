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
| get_financial_facts | symbol, metrics | XBRL values with period and source | us-gaap filers only in the MVP |
| search_x_posts | query, since? | posts as Tier 3 signals with links | V2, not in the MVP (X level 1) |

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
Temporal association only, never a cause. The same code (priceReactionFor in packages/shared) fills FeedCard.priceReaction.
- Input: `{ symbol, eventTime }`. symbol is a demo universe company. eventTime is an ISO time with an offset, not in the future.
- Anchored to the regular session; the Alpaca market calendar defines trading days, opens and closes, so weekends, holidays and early closes resolve to the right day. Prices are SIP minute bars, and only bars older than 15 minutes are used (the free plan).
- Output: `{ anchor, windows, rows, delayed, complete }`.
  - anchor: `{ kind, baseTime, tradingDay }`. kind is `headline` when eventTime falls inside a regular session, `previous_close` otherwise (overnight, weekend, holiday, after an early close). baseTime is eventTime for `headline` and the previous session's close for `previous_close`. tradingDay is the ET date (YYYY-MM-DD) of the session the windows fall in: the headline's session, or the next one.
  - windows: `{ name, endsAt }` in order. `headline` anchor: `15m`, `2h`, `session_close`, from the headline. `previous_close` anchor: `open_gap` (at the open), `15m` and `2h` after the open, `session_close`. A window that would end after the session close ends at the close.
  - rows: the symbol, then SMH, then SPY. Each row: `{ symbol, basePrice, baseBarTime, moves }`.
    - basePrice is the close of the base bar: the last regular bar at or before the headline, or the last bar of the previous session. baseBarTime is that bar's start time.
    - moves has one `{ pct, barTime }` per window. open_gap uses the open of the first regular bar of the trading day; every other window uses the close of the last regular bar that starts at or before endsAt. pct is the percent change from basePrice, rounded to 2 decimals.
    - A bar counts once it closed at least 15 minutes ago (its start plus a minute). pct and barTime are null together: while the bar a window reads could not yet have closed 15 minutes ago, or when there is no bar for it. basePrice and baseBarTime are null when there is no base bar, or while the base is not final (the bar at the headline, or the previous session's close, under 15 minutes old).
    - For a `headline` anchor the windows read from the base bar on, so a window with no later trade repeats the base (0.00).
  - delayed: always true; the data is SIP delayed 15 minutes.
  - complete: true once the bar of every window could have closed at least 15 minutes ago. An incomplete result is never cached.
- A symbol outside the universe fails validation; a future eventTime, or one with no calendar sessions around it, is a tool error.

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

## REST (api)
- GET /health: `{ status: "ok" }`, HealthResponse in packages/shared
- POST /auth/login: body LoginRequest `{ email, password }` (packages/shared; strict, so a user id is rejected). Returns PublicUser (the User without passwordHash and createdAt) and sets the session cookie. A wrong password and an unknown email get the same 401 `{ error: "email or password is wrong" }`; a malformed body gets 400. The persona switcher signs in as a seeded persona with the public demo password.
- POST /auth/logout: clears the session cookie and disconnects that user's sockets; 204.
- GET /me: the signed in user's PublicUser, or 401.
- GET /feed: the signed in user's FeedCard[] with relevance above 0, newest item first (createdAt descending, then _id), at most 50. No cursor yet; the order is stable enough to add one. Relevance 0 items are stored only to mark the event scored for that user (SPEC.md decision log, T05) and never appear in a feed list. 401 without a session.
- GET /events/:eventId/explain: EventExplain in packages/shared, `{ event, source, relevance, path, confidence, evidence }`, for the signed in user. Computed on request by the same code that scores the feed (loadScoringContext and scoreFor in apps/api/src/relevance/feed.ts); it writes nothing, not even a FeedItem. It is how the web shows None for an event no feed list carries. 400 for an id that is not a UUID, 404 for an unknown or unextracted event, 401 without a session.
- POST /events/:eventId/investigate: starts one deep research run (trigger investigate) for the signed in user on the event and answers 202 with that user's FeedCard, research state running with the new run's id. The run goes on in the background (apps/api/src/research/investigate.ts); the card follows it through feed:update. It skips the relevance and importance conditions of the gate; the daily budget lands in T12. 400 for an id that is not a UUID, 401 without a session, 404 when the user has no FeedItem with a path for the event (relevance 0 or unknown), 409 while a run on that item is queued or running. A run whose item stayed running for 15 minutes (for example after an api restart) is taken as lost, and Investigate starts a new one. Investigate again after done or failed starts a new run.
- GET /reports/:reportId: ReportDetail in packages/shared, `{ report, claims, sources, run, card }`, for the signed in user. claims include removed ones; the screens filter on status. sources are ReportSource `{ _id, kind, tier, title, citeLabel, ref }`, built by code for each source a claim cites, without the body text. run is the AgentRun with its steps, as the run screen shows them. card is the user's FeedCard for the event, or null when its FeedItem is gone. 400 for an id that is not a UUID, 401 without a session, 404 for an unknown report or one whose run belongs to another user.
- GET /runs: RunSummary[] in packages/shared, the signed in user's runs without their steps, newest first (createdAt descending, then _id), at most 50: `{ _id, eventId, eventSymbol, agent, mode, trigger, status, tokensUsed, createdAt }`. eventSymbol is the first company the event's extraction named, or null. 401 without a session.
- GET /runs/:runId: RunDetail in packages/shared, `{ run, reportId, claims, eventSymbol, limits }`, for the signed in user (apps/api/src/research/runs.ts). run is the AgentRun with every step as stored; step output is redacted, capped at 8 KB and may quote untrusted text, so clients render it as text only. reportId and claims (removed ones included) are null and empty until the run has a report. limits are FreeTierLimit `{ provider, model, tokensPerMinute, requestsPerDay }` for each model the run's steps used, from the api's limiter table and docs/SPIKE.md; a model with no recorded limits is left out. 400 for an id that is not a UUID, 401 without a session, 404 for an unknown run or one that belongs to another user. The card names its run id from the start of a run, a moment before runResearch stores the AgentRun, so this can answer 404 in that window; the first run:step of the run follows.
- POST /mcp: MCP over stateless Streamable HTTP (see MCP tools), with `Authorization: Bearer <run token>`. A missing, malformed, badly signed or expired token gets 401 with `WWW-Authenticate: Bearer error="invalid_token"` before the SDK sees the request. A malformed JSON body gets 400.
- POST /dev/replay/:sourceId (development only, not mounted in production): sourceId is a provider id, not a Source._id: an Alpaca news id (digits only) or an EDGAR accession number (0001045810-26-000021), told apart by shape. Replays the committed recording `recordings/alpaca/<id>.json` or `recordings/sec_edgar/<accession>.json`, or else the live recording in the recordings collection (T10), through the pipeline (pre filter, injection screen, extraction, relevance) in replay mode. A filing takes its symbol and name from the universe company with its CIK. Returns ReplayResponse in packages/shared, where the ids are the stored Source and MarketEvent:
  - `{ outcome: "processed", sourceId, eventId, sourceCreated, eventCreated }`: the item now has an extraction and a FeedItem for every user. The flags are false when the replay resumed an item stored earlier.
  - `{ outcome: "dropped", reason: "not_in_universe" }`: nothing is stored.
  - `{ outcome: "dropped", reason: "duplicate" | "update", sourceId, eventId }`: the item was already processed (extracted and scored for every user); nothing is extracted or scored again. A second replay of the same item returns duplicate with the same ids.
  - 400 when sourceId is neither an Alpaca news id nor an accession number, 404 when there is no recording (or a filing's CIK is not a seeded company), 503 when a needed model key is missing (the body names it) or both model providers are rate limited. After a 503 the item is stored without an extraction and resumes on the next replay.
  - A replay that scores the event pushes the Socket.IO events below.
- POST /dev/reset/:sourceId (development only, not mounted in production): deletes the FeedItems of that item's event (an Alpaca news id or an accession number, as for replay), for every user, research state included, and nothing else: the Source, the event and its extraction stay. The next replay then scores the event again with no model call and pushes feed:item as a new arrival. Returns ResetResponse `{ sourceId, eventId, deleted }`. 400 for a bad id, 404 when the item was never replayed. The web's Replay control calls reset, then replay.

## Live ingestion
Runs in the api process only where LIVE_INGEST is true, on one machine (apps/api/src/ingest/live.ts). There is no route; live items reach clients as the Socket.IO events below.
- Sources: the Alpaca news WebSocket, subscribed to all news, and an EDGAR poller over the submissions of every universe company every 5 minutes (8-K, 10-Q, 10-K, 20-F and 6-K, no amendments, accepted in the last 24 hours).
- Every item runs processItem in mode live. An item that fails the pre filter is counted and nothing else. One that passes is recorded (LiveRecording in packages/shared, collection recordings, the item as the provider sent it without the article body, first version kept), then queued; the in process queue runs one item at a time and retries a rate limited item up to 3 times.
- A filing becomes a Tier 1 Source with the filer's universe symbol, text null and a title written by code from the company name, the form and the 8-K item labels.
- `npm run recording:export -- --id <id>` copies a live recording to recordings/<provider>/<id>.json for commit.

## Auth
Every route except /health, /auth/login, /auth/logout and /mcp, and every socket, takes the user from the session cookie only; no route, query or socket event names a user.
- Cookie `kesher_session`: httpOnly, SameSite=Lax, Path=/, Secure when NODE_ENV is production, 12 hours.
- Its value is an HS256 JWT signed with JWT_SECRET (at least 32 characters, separate from MCP_TOKEN_SECRET), audience `kesher-web`, claims sub (user id), aud, iat and exp only. A run token never passes as a session: it has another secret and no audience.

## FeedCard
The read model for one feed card, FeedCard in packages/shared, assembled on the server from stored documents (assembleCards, feedCard and feedCardsFor in apps/api/src/feed/cards.ts). Nothing in it is written by a model.
- item: the FeedItem. relevance, path and confidence are computed by code. item.research is `{ state, runId, reportId }`, written by code only: none until Investigate, running with the run's id, then done with its report or failed. reportId is set exactly when the state is done. `npm run seed` backfills reportId null on items stored before it existed.
- event: the MarketEvent with its extraction, without the embedding.
- source: the event's first Source: _id, provider, kind, tier, externalId, url, publisher, title, publishedAt, injectionScreen. The body text stays on the server; it is untrusted data.
- evidence: one entry per hop of the path whose edge is reviewed, in path order: relationshipId, from, to, type, quote, filingDate, url, reviewed, and the filing (sourceId, filer symbol, title, form, tier). The form is the filer's annual form. A hop without reviewed evidence has no entry. A direct holding has none.
- priceReaction: the PriceReaction from get_price_reaction (same shape, dates as dates) for the path's event company and holding, deduplicated, then SMH and SPY; null when the market data could not be read (no Alpaca keys, a provider error). Moves are shown as timing next to the benchmarks, never as a cause.

"Why you" is not a field. Clients render it from item.path with whyYou in packages/shared, the same templates the api uses. Relevance bands come from relevanceBand in packages/shared: high from 0.8, medium above 0, none at 0 (placeholders until T16).

Over JSON and Socket.IO, dates travel as ISO 8601 strings; the client turns them back into dates before parsing with FeedCard.

## Socket.IO events, server to client
The handshake needs the session cookie; without a valid one it fails with `connect_error` "sign in required". Each socket joins its user's room, and closes when the session expires or the user signs out. Only FeedItems with relevance above 0 are pushed as cards (SOCKET_EVENTS in packages/shared).
- feed:item: a FeedCard for a FeedItem that scoring inserted, for its user only
- feed:update: a FeedCard whose FeedItem scoring updated in place, or whose research state changed (running, then done or failed). Clients upsert by event, so a card that rose from 0 arrives as an update too.
- event:scored: `{ eventId }` (EventScored), to every signed in socket, after the cards of that scoring run. It carries nothing about any user; a client with no card for the event may ask GET /events/:eventId/explain.
- run:step: RunStepPushed `{ runId, index, step }`, a step one of the user's runs just stored, with its 0-based place in AgentRun.steps, to that run's user only. The client sends nothing, so the server pushes every run of the user and the run screen keeps the steps of the run it shows. A step it already holds is ignored; a gap in index makes it read GET /runs/:runId again.
- run:end: RunEnded `{ runId, status }`, after the run stored its final status, to that run's user only. The run screen then reads GET /runs/:runId again.
- A run:step or run:end push that fails is logged and never stops the run.
