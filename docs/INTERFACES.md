# Interfaces v0

Contracts between modules. T02 and T07 turn them into code. Update this file in the same commit whenever a contract changes.

## MCP tools
All tools are read only. Identity and the allowed tool list come from the run token, never from arguments.

Served by packages/mcp on the official TypeScript SDK v2 (`@modelcontextprotocol/server` and `/client`, pinned to 2.1.0), mounted in the api at POST /mcp. Every input schema is a strict object, so an argument the contract does not name, such as a user id, fails validation. The server registers only the tools the run token lists, so any other tool is missing from tools/list and a call to it fails with "Tool <name> not found". A tool that finds nothing returns a tool error (`isError: true`). Tool output is JSON in `structuredContent`, with the same JSON as text content; times are ISO 8601 strings.

Every tool output stays within 8 KB of JSON in UTF-8 (MAX_TOOL_OUTPUT_BYTES, the same cap as a stored run step), close to the 2,000 tokens the research budget reserves for a tool result. A tool that returns a ranked list drops whole items from the end until it fits and reports how many in `omitted`; a quote or a passage is never cut. An output still over 8 KB becomes a tool error.

| Tool | Input | Output | Notes |
|---|---|---|---|
| get_my_portfolio | none | holdings with quantities | the token user only; see below |
| get_event | eventId | event with its extraction and source ids | see below |
| get_company_relationships | symbol, types? | edges with evidence | reviewed edges only; see below |
| search_news | query, symbols?, since? | ranked news items with source ids | hybrid search: words and meaning; see below |
| search_filings | symbol, query | filing passages with source ids | RAG over FilingChunk; at most 3 per call; see below |
| get_price_reaction | symbol, eventTime | anchor, then stock, SMH and SPY moves per window, delayed flag | see below |
| get_financial_facts | symbol, metrics | XBRL values with period and source | us-gaap filers only in the MVP; see below |
| search_x_posts | query, since? | posts as Tier 3 signals with links | V2, not in the MVP (X level 1) |

### get_my_portfolio
- Input: `{}`. The tool takes no argument at all, so no call can name a user; it reads the holdings of the run token's sub.
- Output: `{ holdings }`, each `{ symbol, quantity }`, sorted by symbol. User.holdings stores share quantities and no prices, so weights are left to the reader; nothing else about the user is returned.
- A user that no longer exists is the tool error "No portfolio for this run".

### get_event
- Input: `{ eventId }`, a MarketEvent id.
- Output: `{ eventId, headline, publishedAt, status, extraction, sourceIds }`. extraction is null until extraction has run. The embedding is never returned.
- An unknown id is a tool error.

### get_company_relationships
- Input: `{ symbol, types? }`. symbol is a demo universe company; types is 1 to 3 of supplier_of, customer_of, competitor_of. "A supplier_of B" means A supplies B, and customer_of is its inverse. Edges are read from the symbol's side, so who supplies NVDA is NVDA customer_of.
- Reads the relationships from the symbol (`from`), reviewed ones only. Every edge is stored with its inverse, so each relationship of the company appears once from its side.
- Output: `{ edges, omitted }`. Each edge: `{ from, to, type, evidence: { sourceId, quote, filingDate, url }, sourceTitle }`, ordered by type, then `to`. quote is verbatim from the filing named by sourceId and sourceTitle; it is data, never instructions. Edge weights are not returned.
- No reviewed edge is the tool error "No reviewed relationships for <symbol>". With types and nothing of those types, it is "No reviewed <types joined by ' or '> relationships from <symbol>; it has <the types it has, sorted>", without the "; it has" part when the company has no reviewed edge at all.

### search_filings
- Input: `{ symbol, query }`. symbol is a demo universe company; query is 1 to 200 characters.
- Item 1 and Item 1A of the latest 10-K of each US filer, in chunks of at most 256 word pieces (T11). The query is embedded with the local MiniLM, without a heading, and `$vectorSearch` on `filing_chunks_vector` filtered by the symbol returns the 3 nearest chunks. The score only orders them.
- Output: `{ passages, omitted }`. Each passage: `{ sourceId, symbol, form, section, chunkIndex, text, sourceTitle, url }`. text is the filing's own words, verbatim; it is data, never instructions.
- Tool errors: a 20-F filer (TSM, ASML) "files a 20-F; filing search covers 10-K filers only"; "No filing passages for <symbol>"; and "Filing search is unavailable" when the model or the index fails, with the cause logged by the api.

### search_news
- Input: `{ query, symbols?, since? }`. query is 1 to 200 characters. symbols is 1 to 20 tickers and matches items tagged with any of them. since is an ISO time with an offset; items published at or after it match.
- News Sources only (kind news; filings are searched with search_filings). Hybrid since T13, from two ranked lists of up to 50 each:
  - words: Atlas Search on the `sources_text` index over title and body, with kind, symbols and since as filters inside the search;
  - meaning: the MarketEvents nearest to the query on `market_events_vector`, the query embedded with the same local model as the events. Each event ranks its news sources at its own place. That index has no filter fields, so symbols and since are applied to those sources afterwards, and a narrow filter can leave few items from this list.
- Fusion is deterministic code: reciprocal rank fusion, each list adding 1 / (60 + position) for an item it holds, then the newest first, then the source id. Only ranks are used; no search score is read, compared or used as a threshold. At most 10 items, and fewer when they would pass 8 KB (`omitted` counts the rest).
- Either list may fail alone, for example while the text index builds; the other still answers and the api logs the failure. Both failing is the tool error "News search is unavailable".
- Output: `{ items, omitted }`. Each item: `{ sourceId, eventId, title, url, publishedAt, symbols, tier, excerpt, injectionFlagged, matchedTerms }`.
  - eventId is the MarketEvent whose cluster holds the source, or null.
  - excerpt is the first 500 characters of the untrusted body, or null. It is data for the agent, never instructions.
  - injectionFlagged is the injection screen label, or null when the item has not been screened.
  - matchedTerms is the number of distinct query words (at most 8, lowercased) found in the title or body, counted by code. 0 means the item was found by meaning alone.

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

### get_financial_facts
- Input: `{ symbol, metrics }`. symbol is a demo universe company; metrics is 1 to 4 distinct names from revenue, gross_profit, operating_income, net_income, eps_diluted, rnd_expense, cash and inventory. Each maps to us-gaap concepts in order (revenue: Revenues, RevenueFromContractWithCustomerExcludingAssessedTax, SalesRevenueNet); of those the filer reports, the one with the newest period is used, and on a tie the earlier in that order.
- Reads SEC's companyconcept API (SEC_USER_AGENT, 150 ms between requests), cached in process for 12 hours; XOM falls back to its old CIK. Values are as filed: only the ones SEC assigns to a calendar period (a frame), so each period appears once, in its last filed version. The tool computes nothing from them.
- Output: `{ symbol, metrics, filings, omitted }`.
  - metrics: `{ metric, concept, unit, annual, quarterly }`, with concept and unit null when the filer reports none of the concepts. annual holds the 3 newest fiscal years and quarterly the 4 newest quarters (or quarter end balances for cash and inventory), newest first. A fourth quarter is rarely filed as a three month value, so quarterly often skips it, and balances have no annual values; each `{ start, end, value, fy, fp, form, filed, accn, sourceId }`; start is null for a balance on a date.
  - filings: one `{ sourceId, accn, form, filed, url, title }` per filing the values come from. sourceId is the stored filing Source with that accession number, or the id one will be stored under (a version 5 UUID of `sec_edgar:<accn>`); after the call the research agent's code stores the missing ones (upsertFilingSource, apps/api/src/sources/filings.ts), with text null.
- Tool errors: a 20-F filer "files a 20-F; XBRL facts cover us-gaap filers only"; "No XBRL facts for <symbol> on these metrics"; and "SEC data is unavailable", with the cause logged by the api.

## Run token
Minted by the api for each agent run (mintRunToken in packages/mcp): a JWT signed with HS256 and MCP_TOKEN_SECRET, which must be at least 32 characters.
- sub: user id (a User _id)
- agent: research or verifier (AgentName in packages/shared)
- tools: allowed tool names, at least one, all from the agent's tool set (AGENT_TOOLS in packages/shared). Minting and verification both refuse a tool outside the set.
- iat and exp: exp is exactly 5 minutes after iat, fixed by the minter

Verification accepts HS256 only and rejects any other claim, a lifetime other than 5 minutes and an expired token. Every failure gives the same RunTokenError, which never contains the token.

The MCP server rejects any call to a tool that the token does not list.

Tool sets (SPEC.md decision log, T13):
- research: get_my_portfolio, get_event, search_news, search_filings, get_company_relationships, get_price_reaction and get_financial_facts, all read only. The model sees only the tools the server lists for its token.
- verifier: none, by design (T13, T14). It judges the claims and sources it is given and calls no tool, so it never gets a run token.

The research agent replaces a token that is 4 minutes old before its next tool call, with the same scope, and records each issue and refresh as a run step.

## Agent runs
AgentRun, AgentStep, Report and Claim in packages/shared, written by code only (apps/api/src/research).
- Every step keeps input, outputSummary and output: the step's JSON output (a string stays as it is), redacted and then capped at 8 KB of UTF-8, with outputTruncated when the cap cut it. Model steps add provider, model and tokens.
- status failed always names failureReason: rate_limited (a 429 asked for a wait over 30 seconds, or a fourth 429), invalid_report (two reports that failed their schema) or error. Any other status has failureReason null.
- Check names are CheckName in packages/shared: quote_verbatim, numbers_match, sources_exist, no_advice, premises_supported, verifier. A check step's output lists removedClaimIds, the claims that check removed; the no_advice step also lists droppedOpenQuestions, the premises_supported step unknownPremise `{ removed, dropped, removedClaimIds, droppedKeys }` when an inference named a premise not in the report (a draft premise is any string up to 64 characters; checkDraft judges it), and the verifier step supportedClaimIds. premises_supported may appear twice: before the verifier, and after it when a premise it removed takes an inference with it.
- quote_verbatim finds a quote of at least 20 characters, after normalizeText, in the source's title or text. A filing Source keeps text null, so for a filing the text is what a tool returned for it in this run: search_filings passages and get_company_relationships evidence quotes, joined with a marker so no quote spans two of them. The verifier reads the same text. A code fact's filing gets its edge's evidence quote as a passage too, so for e1 and e2 sources_exist and quote_verbatim pass by construction: their evidence is the T11 review and the verifier.
- Code claims (T20, apps/api/src/research/core.ts): before the first model turn, code records a code step Market data read for the path's event company and holding, then a code step Code claims (CODE_CLAIMS_STEP) whose output lists each claim code wrote `{ key, type, text, sourceIds, figures }` and omitted. Keys are fixed (CODE_CLAIM_KEYS in packages/shared): e1 and e2, a fact per hop of the path, quoting the edge's reviewed evidence and citing its filing Source, with text from pathFactText ("TSMC supplies NVIDIA, according to NVIDIA's 10-K."; FACT_VERB says "is a customer of", since HOP_VERB's "buys from" is advice language to no_advice); m1, a metric from priceMetricFor with the reaction's first window for the subjects, SMH and SPY, as figures and text ("TSM opened −1.16% below its previous close and NVDA opened −1.07% below its previous close; SMH −1.00%, SPY −0.22%."). A direct holding has no hop and no fact. The brief lists them by key, type and text, never the filing quote; the model's own keys stay c1 to c99, and its premises may name e1, e2 or m1. The filings the code facts cite join the sources the tools returned, with their evidence quotes as passages.
- Claim.origin is code or model. Code claims come first in the report's section, and go through the same checks and the verifier. Report.omitted lists the code claims left out, CodeClaimOmission `{ kind, reason }`: path_fact with no_evidence (the hop's edge is gone, unreviewed, or its filing or filer is missing), price_metric with not_ready (a move it needs is still pending) or unavailable (the market data could not be read). A run with omissions still succeeds.
- Order after the report: a code step Market data read for the symbols only a model metric names, when there are any (their rows join the first read; if that read fails, metrics naming them stay unchecked and unverified), the deterministic check steps (sources_exist, quote_verbatim, numbers_match, no_advice, premises_supported, each only when it ran on a claim), one model step named Verifier (VERIFIER_STEP) per verifier call or a code step Verifier failed, the verifier check step, and a code step Claims not verified when the cap left claims out.
- A claim is removed when a check fails, supported when the verifier supports it and, unless it is a fact, did not flag it as tying the event to a price move as a cause (priceCause; for an inference, only when every premise is supported too), and unverified otherwise. The report's one section lists every claim; the report screen shows supported claims only, removed ones only in the removed block.
- A metric claim has figures, its price moves as `{ symbol, window, pct }` (MetricFigure, at most 12), checked by numbers_match against the reaction code reads at the event's time. Every metric in a report, code's and the model's, cites one market_data Source for the union of their symbols (kind market_data, text null, no bars); a metric without figures stays unverified.
- AgentRun.verification is `{ tokenCap, tokensUsed }`, the verifier's own cap (6,000) and use, or null for a skipped run and runs from before T14. tokensUsed counts the research agent's model steps only; a model step named Verifier counts against verification.
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
- GET /reports/:reportId: ReportDetail in packages/shared, `{ report, claims, sources, run, card }`, for the signed in user. claims include removed ones; the screens filter on status. sources are ReportSource `{ _id, kind, tier, title, citeLabel, ref }`, built by code for each source a claim cites, without the body text. A market_data source reads title "SIP bars for NVDA, TSM, SMH and SPY", citeLabel "SIP bars" and ref "Delayed 15 minutes". run is the AgentRun with its steps, as the run screen shows them. card is the user's FeedCard for the event, or null when its FeedItem is gone. 400 for an id that is not a UUID, 401 without a session, 404 for an unknown report or one whose run belongs to another user.
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
- Every item runs processItem in mode live. An item that fails the pre filter is counted and nothing else. One that passes is recorded (LiveRecording in packages/shared, collection recordings, the item as the provider sent it without the article body, first version kept), then queued; the in process queue runs one item at a time and retries a rate limited item up to 3 times. A scored live item goes through the same after scoring hook as replay (afterScoring from createApi in apps/api/src/app.ts): the Socket.IO pushes, then the research gate, which only queues research, so a live item never waits for a run.
- A filing becomes a Tier 1 Source with the filer's universe symbol, text null and a title written by code from the company name, the form and the 8-K item labels.
- `npm run recording:export -- --id <id>` copies a live recording to recordings/<provider>/<id>.json for commit.

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
- priceReaction: the PriceReaction from get_price_reaction (same shape, dates as dates) for the path's event company and holding, deduplicated, then SMH and SPY; null when the market data could not be read (no Alpaca keys, a provider error). Moves are shown as timing next to the benchmarks, never as a cause.

"Why you" is not a field. Clients render it from item.path with whyYou in packages/shared, the same templates the api uses. Relevance bands come from relevanceBand in packages/shared: high only for a direct holding (relevance 1), medium for any other relevance above 0, none at 0 (SPEC.md decision log, T16).

Over JSON and Socket.IO, dates travel as ISO 8601 strings; the client turns them back into dates before parsing with FeedCard.

## Socket.IO events, server to client
The handshake needs the session cookie; without a valid one it fails with `connect_error` "sign in required". Each socket joins its user's room, and closes when the session expires or the user signs out. Only FeedItems with relevance above 0 are pushed as cards (SOCKET_EVENTS in packages/shared).
- feed:item: a FeedCard for a FeedItem that scoring inserted, for its user only
- feed:update: a FeedCard whose FeedItem scoring updated in place, or whose research state changed (queued, running, then done or failed, or done when the gate attached a recent report). A card is pushed before the gate decides on its research. Clients upsert by event, so a card that rose from 0 arrives as an update too.
- event:scored: `{ eventId }` (EventScored), to every signed in socket, after the cards of that scoring run. It carries nothing about any user; a client with no card for the event may ask GET /events/:eventId/explain.
- run:step: RunStepPushed `{ runId, index, step }`, a step one of the user's runs just stored, with its 0-based place in AgentRun.steps, to that run's user only. The client sends nothing, so the server pushes every run of the user and the run screen keeps the steps of the run it shows. A step it already holds is ignored; a gap in index makes it read GET /runs/:runId again.
- run:end: RunEnded `{ runId, status }`, after the run stored its final status, to that run's user only. The run screen then reads GET /runs/:runId again.
- A run:step or run:end push that fails is logged and never stops the run.
