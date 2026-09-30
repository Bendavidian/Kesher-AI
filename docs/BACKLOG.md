# Backlog

Status marks: [ ] todo, [~] in progress, [x] done. Task ids are stable; never renumber.
Walking skeleton: T00 to T09 by the end of day 3. Then deepen.

## Phase 0: validation

### [x] T00 Spike: verify every external dependency
Scripts in /spike (TypeScript run with tsx), kept in the repo as evidence, outside the future workspaces. Results in docs/SPIKE.md: pass or fail, evidence, limits observed. Every service on a free tier. Checks run in this order:
1. SEC: fetch NVIDIA's latest 10-K through the submissions API with a declared User-Agent; locate the TSMC foundry passage.
2. Finnhub: peers and profile for NVDA and TSM.
3. Alpaca: receive live news over WebSocket; fetch the TSM news item for the planned demo event, the April 2024 Taiwan earthquake (2 to 4 Apr 2024), falling back to July 2026 if none is found; SIP bars for NVDA, SMH and SPY in a window around that item.
4. Groq: one structured output call. Record latency, token usage and the daily quota shown in the console.
5. Gemini Flash-Lite: one structured output call. Record latency, token usage and the daily quota shown in the console.
6. Embeddings at zero cost: Gemini embeddings on the free tier (model, dimensions, latency, quota) and local Xenova/all-MiniLM-L6-v2 through @huggingface/transformers (dimensions, model load time, latency per text). Recommend one, since it fixes the vector index dimension.
7. MongoDB Atlas free tier: create a vector index over real embeddings from the recommended option, run one $vectorSearch and one $graphLookup.
A check whose key is missing reports "skipped: missing key" and does not block the others.
Done when: docs/SPIKE.md covers all seven checks with evidence, and every failure comes with a proposed change to SPEC.md.

## Phase 1: walking skeleton, thin and end to end

### [x] T01 Monorepo scaffold
npm workspaces: apps/web, apps/api, packages/shared, packages/mcp. TypeScript strict, ESLint, Prettier, vitest. Scripts dev, test, typecheck and lint that work on macOS and Windows. A .claude/launch.json with the web and api servers. A GitHub Actions workflow for typecheck and test.
The Tailwind theme defines the tokens from docs/UI.md, and the web shell renders the terminal frame: top bar, three panels and the ticker footer.
Done when: npm run dev shows the web shell in the Browser pane with the theme tokens from docs/UI.md and the terminal frame (top bar, three panels, ticker footer), GET /health returns ok, and CI passes.

### [x] T02 Domain model and seed
Types and zod schemas in packages/shared for every entity in SPEC.md, Mongo collections and indexes, and a seed script for the three personas, the demo universe and six hand written edges with evidence (five were planned; the quote review on 28 Sep 2026 added LRCX supplier_of TSM for a two hop supply chain path).
Company has primaryListing next to symbol. Every relationship is stored in both directions with its inverse type (supplier_of with customer_of, competitor_of both ways). The seed config holds DEMO_SOURCE_ID=38062166. Vector indexes use 384 dimensions, cosine.
Done when: the seed runs twice without duplicates, and a test validates every seeded document against its schema.

### [x] T03 Replay ingestion
POST /dev/replay/:sourceId loads one recorded or historical item, stores a Source and creates a MarketEvent through the same path live items will use. Replay selects items by id, never by keyword.
Done when: replaying DEMO_SOURCE_ID (Alpaca news 38062166) creates exactly one Source and one MarketEvent.
Notes from T03 for later tasks:
- T04: every item enters through ingestItem (apps/api/src/ingest/ingest.ts), which stores the Source and creates its MarketEvent. Put the pre filter there. Decide whether a dropped item is still stored as a Source; its counters need somewhere to live. ingestItem already reports sourceCreated, which the duplicate and update reasons can use. The screen and extraction read Source.text, which is null when the provider sent no summary; the demo item has one.
- T10: live Alpaca items map through toIncomingItem, the same as replay. Provider symbols must pass the Ticker schema, or the whole item fails validation; filter bad symbols before ingest. An item with an empty url fails Source.url. Decide where live recordings go on the deployed instance: the recordings files or a collection.

### [x] T04 Extraction, thin
Order: pre filter, then the injection screen, then extraction.
Pre filter, code only: an item passes only when its provider symbols (Alpaca news symbols, EDGAR filer CIK) include a demo universe company. SPY and SMH alone do not pass, and items with no symbols are dropped. A source id that was already processed is not extracted again; an update to it is logged. Every dropped item is counted by reason: not in universe, duplicate, update.
Injection screen: untrusted text goes through Groq meta-llama/llama-prompt-guard-2-86m, long texts in short chunks, and the result is stored on the Source. Flagged items get a label and stay visible; the screen never decides relevance, gating or writes.
Extraction: one structured call on Groq openai/gpt-oss-120b with low reasoning effort, validated with zod: companies with per entity impact, event type, themes, importance with the rubric in SPEC.md. The model gets no tools, and the article is passed as quoted data.
A shared model client with a limiter that respects each provider's tokens per minute. Single calls (extraction, later the verifier) fall back to Gemini gemini-3.5-flash-lite per call on a 429. The client also picks one provider for a whole run, used by T08. A smaller Groq model does not help: openai/gpt-oss-20b and qwen/qwen3.8-27b have the same limits as gpt-oss-120b.
Done when: a unit test on a recorded model response extracts TSM from the TSMC item with importance of at least 3; tests cover each pre filter drop reason and its counter; a flagged item keeps its label and still reaches extraction; and a Groq 429 sends that single call to Gemini.

### [x] T05 Relevance, thin
Graph propagation up to 2 hops with $graphLookup, scoring per SPEC.md, the path saved on the FeedItem, "Why you" rendered from templates.
Done when: a deterministic test gives the TSMC event high relevance for persona B (direct), high for persona A (supplier path) and none for persona C, and a second test proves traversal in both directions: news about AMD reaches persona A through NVDA competitor_of, and news about NVDA reaches a TSM holder through customer_of.
Notes from the UI track (contract gap: feed:item carries only a FeedItem with ids, but the feed screen needs the full card):
- Define a FeedCard read model in packages/shared, assembled on the server. It holds the FeedItem, the MarketEvent with its extraction, the Source (publisher, tier, externalId), the evidence for each hop (quote, filing name and form), and the price reaction, which stays null until T13. GET /feed returns FeedCard[], and feed:item and feed:update carry a FeedCard. Update INTERFACES.md.
- Add a nullable publisher field to Source, filled from the Alpaca item (for example "Benzinga"). The seed sets it to null for filings.
- Move the "Why you" path templates from apps/web/src/view/path.ts into packages/shared, so the server and the web render the same wording.
- Set the relevance bands. The UI uses High from 0.8, Medium above 0 and None at 0 as placeholders; T16 calibrates them. Decided in T16: high only for a direct holding, medium for any other relevance above 0 (SPEC.md decision log, T16).

### [x] T06 Live feed with persona switcher
Web feed with cards pushed over Socket.IO, and login as any of the three personas.
Build to docs/UI.md, including the one column layout below 1280px. docs/design/feed.dc.html is markup reference only; it needs the design canvas runtime and does not run on its own. The real spike values shown in the design (the demo headline, the 10-K quote and the anchored price moves) are fixtures for the replay demo and its tests.
Done when: replaying the TSMC event updates three open browser sessions with three different cards.
Note from the UI track: login for the persona switcher needs a PublicUser type in shared and POST /auth/login with the demo password; the switcher logs in as the chosen persona.
Notes from T05:
- Mount GET /feed with feedCardsFor(db, userId) from apps/api/src/feed/cards.ts, taking userId from the auth context only. It has a limit but no cursor yet; its order (createdAt descending, then _id) is stable enough to add one. Emit feed:item with feedCard(db, item) for each FeedItem that scoreEvent (apps/api/src/relevance/feed.ts) writes; processItem calls it after extraction.
- FeedCard dates arrive as ISO strings over JSON and Socket.IO; convert them before FeedCard.parse on the web.
- Replace the web fixtures with FeedCards. Render "Why you" with whyYou and the bands with relevanceBand from packages/shared; the web view already uses both.
- The seed ran `backfillPublishers`; run `npm run seed` on each machine's database once before T06.
- The feed and every FeedCard list hide relevance 0 (SPEC.md decision log, T05). The stored relevance 0 items only mark the event scored for that user. feedCardsFor still returns them, and its comment says so: filter on relevance above 0 there. Emit no feed:item or feed:update for a relevance 0 item.

Notes from T06 for later tasks:
- T08: the Investigate button in apps/web/src/components/ScoresPanel.tsx stays disabled; wire it to POST /events/:eventId/investigate and take the user from the session (currentUser in apps/api/src/auth/session.ts). feed:update is already pushed for a changed FeedItem, and the web upserts by event.
- T10: live items reach the sockets through processItem's onScored hook, which server.ts wires to publishScored. Nothing else is needed for live pushes.
- T13: FeedCard.priceReaction is still null; EventDetail and TickerFooter already render a reaction when one arrives (view type PriceReaction in apps/web/src/view/types.ts).
- Hardening before real accounts: NODE_ENV unset counts as development (dev routes on, cookie not Secure); consider requiring it, an Origin allowlist on the socket handshake, and a login rate limit.

### [x] T07 MCP server, thin
packages/mcp with get_event and search_news, and run token verification with user and tool scopes.
Done when: a test proves that a token without search_news is rejected, and no tool accepts a user id argument.
Notes from T07 for later tasks:
- T08: mint one token per run with mintRunToken(secret, { userId, agent, tools }) from @kesher/mcp, taking userId from the auth context only. Connect `Client` with `StreamableHTTPClientTransport` to POST /mcp and pass the token as `Authorization: Bearer`. The token lives 5 minutes, so a run longer than that needs a fresh token. Tool results are in structuredContent; a tool that finds nothing returns isError. search_news excerpts are untrusted text.
- T13: add each tool to TOOLS in packages/mcp/src/tools.ts with a strict input schema; the user id test in tools.test.ts covers new tools automatically. get_my_portfolio reads the user from ctx.claims.sub, never from arguments. Replace the thin search_news with hybrid search behind the same contract. It ranks only the 200 newest matching items today.

### [x] T08 Research agent, thin
The Investigate button starts a run. The agent calls the two tools within a step budget and a token budget (20,000 tokens per run in deep mode and 12,000 in auto, replacing the first 6,000; SPEC.md decision log, T08) and returns claims as JSON. Model calls go through the limiter from T04. The run picks its provider once at the start: Gemini gemini-3.5-flash-lite, or Groq openai/gpt-oss-120b for the whole run if Gemini is over its limit. It never switches mid-run; on a 429 inside the run the limiter waits and retries. Tokens, provider and model are recorded per step in the AgentRun. A basic deterministic check confirms each quote appears in its source. The report attaches to the card, which renders a basic report view with claims and sources; T14 completes it to docs/UI.md.
Note from T04: the model client (apps/api/src/llm/client.ts) already has pickRunProvider(budgetTokens) and a limiter per model; record the provider and model it returns on each AgentRun step.
Notes from the UI track, for the wiring in T08 and T09:
- AgentName is already exported from packages/shared (T07), but the web still derives it locally from AgentRun['agent'] in apps/web/src/view/types.ts; switch to the shared one. Move the run token scope type (ToolName, now in packages/mcp/src/token.ts) into packages/shared and export it, so the web can name tool scopes.
- AgentStep keeps only outputSummary. Add an output field with the step's JSON output, capped at 8 KB with a truncated flag and passed through redaction, so the run screen shows real tool output.
- Define the check names once in packages/shared: quote_verbatim, numbers_match, sources_exist, premises_supported, verifier.
- Add a read model for report sources (title, quote label, id) and api routes for the report and its claims (T08), one run and the run list (T09). The Agent runs tab then uses the run list instead of the fixture import in apps/web/src/routes.ts.
- The api serves the free tier limits shown in the run screen footer, instead of the copy in apps/web/src/view/run.ts.
Done when: Investigate on the TSMC card returns a report in which every fact claim has a source id and a verified quote, and a test shows that a 429 in the middle of a run is retried on the same provider.
Split in two parts under this id, because Investigate needs the auth context from T06:
- Part 1, now: the research agent, the AgentRun steps, the claims, the quote check, the recordings, and the test that a 429 in the middle of a run is retried on the same provider. No new route. A dev only script (`npm run research:dev`) runs the agent for persona A on the demo event against Atlas; it mints the run token itself and is never loaded in production. The 6 and 15 step budgets count tool calls. A fact whose quote is not in its source is removed; one whose quote is found stays unverified until T14. A 429 waits at most 30 seconds per wait and is retried at most 3 times; otherwise the run fails as rate_limited with no report.
- Part 2, after T06 merges: POST /events/:eventId/investigate with the user from the auth context, the Investigate button, and the basic report on the card.
Notes from part 1 for part 2:
- Call runResearch(deps, { userId, eventId, mode: 'deep', trigger: 'investigate', gateReason }) from apps/api/src/research/agent.ts with userId from the auth context. deps.mcp.url is the api's own POST /mcp. It throws ResearchInputError, writing nothing, when the user has no FeedItem with a path for the event; answer 404 or 409 there.
- The run is inline and takes seconds; part 2 decides whether the route waits or answers 202 and emits run:step and feed:update. FeedItem.research is not written yet.
- The report lists removed claims too, so the card and report views filter on status.
Notes from part 2 for later tasks:
- T09: the card carries research.runId from the start of a run, but the AgentRun document appears only once runResearch inserts it, a moment later; GET /runs/:runId may answer 404 in that window. View agent run stays disabled on the card, and the report screen's run links still open the fixture run screen. run:step is not sent yet.
- T09: the web revives ISO strings to dates everywhere except step inputs (decodeReport keeps AgentStep.input as sent); decode GET /runs/:runId the same way.
- T12: the daily budget check belongs in startInvestigation (apps/api/src/research/investigate.ts), which Investigate must not skip. The run is a fire and forget promise in the api process; the job queue replaces it. A run lost to a restart leaves its AgentRun in status running; only its FeedItem is taken over after 15 minutes (STALE_RESEARCH_MS).
- T14: until the verifier supports facts, every inference stays hidden on the report screen with a neutral line ("1 inference waits for verification", buildReportView in apps/web/src/view/report.ts). The removed block and the red segments count only claims with status removed.

### [x] T09 Agent Runs view, thin
A timeline of one run: trigger, steps, tool calls with latency, sources, check results, token usage.
Build to docs/UI.md. docs/design/agent-run.dc.html is markup reference only; it needs the design canvas runtime and does not run on its own.
Done when: the run from T08 is fully inspectable from its card.
Notes for later tasks:
- T12: gate runs appear in GET /runs and the run screen as they are; the summary line already words trigger gate. A run lost to a restart stays running in the list, since only its FeedItem is taken over.
- T14: a check step turns red when its output lists removedClaimIds, so the verifier should record removals the same way. Its model steps add their provider and model to the served limits by themselves.
- Each run screen opens its own socket next to the feed's; share one connection if more screens listen.

## Phase 2: deepen

### [x] T10 Live ingestion and recording
Alpaca news WebSocket and an EDGAR poller for the universe. Every live item is recorded for replay. The free Alpaca plan allows one live WebSocket, so live ingestion runs only where LIVE_INGEST is on, which is one machine only.
Done when: a live news item reaches the feed without manual action and can be replayed later.
Notes from T04:
- Every item goes through processItem (apps/api/src/ingest/process.ts) with mode live, which runs the pre filter, the injection screen and the extraction and counts drops in ingest_counters. Replay uses mode replay.
- EDGAR items must carry the filer's universe symbol, mapped from the CIK, in symbols before processItem, or the pre filter drops them.
- The job queue should serialize work per source id. processItem skips steps that already ran and its writes are conditional, so concurrent calls for one item stay correct, but each can spend a model call before the loser's write is discarded.
- Note from T05: graph start nodes are the extracted companies that the event's sources tagged, taken as the union over the cluster (eventCompanies, apps/api/src/relevance/score.ts). Once clustering puts several items in one event, an untrusted later item can widen that set; decide then whether to intersect per source.
Notes from T10 for later tasks:
- T11: a live filing's Source has text null and a code written title (company, form, 8-K item labels), so extraction reads only that title. Once filing chunks exist, decide whether live filings get their text screened and extracted.
- T16: live rows of ingest_counters now fill up where LIVE_INGEST is on; items that fail the Source schema are logged, not counted.
- T18: the deployed instance needs LIVE_INGEST=true with the Alpaca keys and SEC_USER_AGENT, and both development machines false. Recordings go to the database there, so nothing on its disk needs to last. Superseded in T18: the deployed instance is replay only (SPEC.md decision log, T18).

### [x] T11 Graph build job
Finnhub peers and profiles. LLM extraction of supplier and customer edges from 10-K sections with verbatim quotes. A review CLI to accept or reject edges. The same sections chunked and embedded into FilingChunk.
Peers are kept only inside the demo universe. Every edge is written in both directions with its inverse type. primaryListing comes from the Finnhub profile (check ASML as well as TSM). Chunks of at most 256 tokens, embedded with local Xenova/all-MiniLM-L6-v2 (384 dimensions).
Done when: every candidate with a verbatim quote from the 10-K and 20-F filings has been reviewed, the final count of distinct reviewed relationships is reported, and filing search limited to NVDA returns NVIDIA foundry passages in its top 3 for "foundry dependency" and the TSMC foundry passage first for "TSMC foundry dependency". The bare query came from the five document spike; in the full 10-K, NVIDIA's own foundry risk passages are correct answers for it (SPEC.md decision log, T11). There is no minimum count: a fixed target pushes toward weak evidence, which "no evidence, no edge" prevents (SPEC.md decision log, T11). The earlier target of 40 reviewed edges is dropped.
Scope decided on 29 Sep 2026: candidates start from docs/research/edge-candidates.md and add evidence from the TSM and ASML 20-F filings (edge evidence only, no FilingChunks). Filing chunks cover Item 1 and Item 1A of the 15 10-K filers. Nothing is written with reviewed: true before the user approves it in the review CLI.
Decisions from T02, resolved on 29 Sep 2026 (SPEC.md decision log, T11): Finnhub peers are candidates only and every competitor_of edge has a filing quote; in_sector and has_theme stay Company attributes (Finnhub sectors put AMZN in retail and GOOGL and META in media, so T16 decides whether theme overlap adds relevance); the seed owns the Company reference fields and the six demo edges, T11 owns every other relationship and the filing chunks. XOM falls back to CIK 0000034088, which still holds its latest 10-K.
Done on 29 Sep 2026: 28 proposed relationships reviewed by the user (22 accepted, 6 rejected), so Atlas holds 28 distinct reviewed relationships (6 seeded, 22 from T11) in 56 edge documents, and 2,010 filing chunks. Limited to NVDA, "foundry dependency" returns NVIDIA's foundry risk passages in the top 3 and "TSMC foundry dependency" the TSMC passage first. The demo still scores A 0.8 through TSMC supplies NVIDIA, B 1 and C 0.
Notes from T11 for later tasks:
- T13 part 2: search_filings reads filing_chunks with a $vectorSearch on filing_chunks_vector, filtered by symbol, at most 3 chunks (apps/api/src/graph/search-cli.ts shows the query). Embed the query with localEmbedder (apps/api/src/graph/embed.ts), without a heading prefix. The api process then loads the model, about 90 MB, from .cache/models (T18 checks the host's memory). get_company_relationships reads reviewed relationships with their evidence.
- T13 part 2: chunk text is the filing's own text with its heading lines; the vector was computed from "heading. text". The TSM and ASML 20-Fs have no chunks (foreign issuer RAG stays V2).
- T14: filing Sources keep text null, so a quote check for a claim citing a filing must search the FilingChunk texts of that Source. A quote that spans two chunks would fail; decide whether to also check the joined text of neighbouring chunks.
- T16: data/graph/candidates.json holds the model's role next to the research decision for 110 (sentence, company) rows, and data/graph/reviews.json the user's decisions; together they measure the edge extractor. The model proposed an edge on 18 rows the research rejected.
- Existing FeedItems are not scored again when the graph grows; only new events and replays after a dev reset use the new edges.

### [x] T12 Gate policy and automatic research
The gate from SPEC.md: relevance threshold, importance of at least 4, dedupe per event cluster, daily budget. Cards appear immediately and research attaches asynchronously.
Done when: tests cover every gate condition, and a card is visible before its research completes.
Notes from T12 for later tasks:
- Web, after T09 (new item): the run list and GET /runs now hold skipped runs (trigger gate, status skipped, startedAt null, one Gate check step with the condition and reason). The run summary in apps/web/src/view/run.ts says "Started by the research gate" for every gate run, a skipped one too; show "Skipped by the research gate" with AgentRun.gate.reason instead. The Agent runs tab opens the newest run, which after a Replay is often a skip; consider opening the newest run that was not skipped. A queued card has research.runId before its AgentRun exists, for longer than before, since the queue runs one run at a time; the run screen already loads on the first run:step.
- T10: live items must go through the same after scoring hook as replay: createApp in apps/api/src/app.ts composes onScored with autoResearch (afterScoring). Expose it to the live ingester rather than passing server.ts's onScored alone, or live cards get no automatic research. Done in T10: createApi returns afterScoring and server.ts hands it to startLiveIngest.
- T16: a failed run counts as recent, so the gate does not retry it for 24 hours; only Investigate does. Decide whether failed runs should leave the recent check. A queue that keeps a job waiting past 15 minutes lets the next Investigate take the card over, and the waiting job's reserved run stays counted.
- Possible flake, found in T10: auto.integration.test.ts, "with AUTO_RESEARCH off, records auto_research_off for every card and calls no model", failed once under full suite load on macOS after merging main with T11, then passed alone and in a second full run. The failure output was not kept; if it recurs, capture it and look for a wait that depends on timing (settled, the replay's gate writes). It recurred three times in T13 part 2; now T21.
- T16: tune GATE_MIN_RELEVANCE, GATE_MIN_IMPORTANCE and RECENT_RUN_MS (apps/api/src/research/gate.ts) and DAILY_RUN_LIMIT and AUTO_RUN_LIMIT (dailyBudget.ts). The research_budget collection shows the runs reserved per day.

### [x] T13 Full MCP tool set
Every tool in INTERFACES.md, a tool set per agent, and get_price_reaction with benchmarks and the delayed flag. Windows are anchored to the regular session through the Alpaca market calendar, and the result states its anchor. search_filings returns at most 3 chunks per call.
Done when: each agent's token lists only its own tools, and get_price_reaction returns stock and benchmark moves for the TSMC window anchored to the previous close, and a test covers a weekend, a holiday and an early close headline.
Split in two parts under this id, because search_filings and the hybrid search need the filing chunks and the embedder from T11:
- Part 1, now: the price reaction. get_price_reaction as an MCP tool, and FeedCard.priceReaction filled by the same code: SIP bars from Alpaca, windows anchored as decided in T00 finding A, the Alpaca market calendar for weekends, holidays and early closes, the anchor stated in the output, SMH and SPY in the same windows, always labeled as delayed 15 minutes and never stated as a cause. The web market table and open gap bars show the values instead of the empty state. Raw SIP bars stay out of git (Alpaca's data terms; the repo becomes public): recordings/alpaca-bars/ is a gitignored local cache that `npm run record:bars` fills. The market calendar recordings and the computed PriceReaction of the demo event are committed. CI tests use synthetic bars and that fixture; the test that reproduces SPIKE.md from real bars runs locally and skips when the cache is missing.
- Part 2, now that T11 is done: get_my_portfolio, get_company_relationships, search_filings, get_financial_facts, the hybrid search_news behind the same contract (event embeddings, the Atlas text index), and a tool set per agent.
Done when for part 1: get_price_reaction returns stock and benchmark moves for the TSMC window anchored to the previous close, equal to docs/SPIKE.md check 3, a test covers a weekend, a holiday and an early close headline, and the demo card shows the moves next to the benchmarks.
Part 1 is done (29 Sep 2026). Notes for part 2 and later tasks:
- Tool sets per agent: resolved in part 2 (AGENT_TOOLS in packages/shared; research has get_price_reaction, and research:dev passes the market data).
- The committed calendar holds 2024 only. Live headlines in other years read the calendar from Alpaca once per process; record more years with `npm run record:bars` when a test or the demo needs them.
- An incomplete reaction (a session still under way) is computed again on every card request; add a short TTL if live feeds make that costly. The memo of whole sessions in data.ts has no cap.
- T10: decide how live reactions persist (no collection stores bars or reactions yet), and whether live bars feed the local cache.
- T14: a metric claim can check its numbers against the same PriceReaction (numbers_match).

Part 2 is done (29 Sep 2026): the seven tools, agent tool sets, hybrid search_news, event embeddings, the 8 KB cap and filing quote checks (STATE.md). Each agent's token lists only its own tools. The 10-K fact and the price metric passed on Atlas in separate runs, not in one report; T20 makes both code claims. Notes for later tasks:
- T16: add a retrieval eval (recall at 3) on the hybrid search_news and search_filings, and measure how often a real run carries a 10-K fact and a price metric until T20 lands. Tune the budgets of 32,000 and 16,000 against the requests a deep run makes (500 a day on Gemini).
- T16 or T20: a quote that spans two filing chunks still fails quote_verbatim; the passages are joined with a marker on purpose.
- get_financial_facts: a fourth quarter is rarely filed as a three month value, so quarterly often skips it; values from it are metrics without figures and stay unverified until numbers_match gets an XBRL branch.

### [x] T14 Full verification
Typed claims (fact, metric, inference), deterministic checks, an independent verifier agent. Unsupported facts are dropped, and inferences appear only with supported premises.
The research report screen is completed to docs/UI.md: claim type chips, statuses, the supported and removed bar, the removed claim block and the sources panel. docs/design/report.dc.html is markup reference only; it needs the design canvas runtime and does not run on its own.
Done when: every planted error in a fixture report is caught, and the rendered report contains only supported claims.
Note from the UI track: check steps record the ids of the claims they removed, so the run screen colors only the check that removed a claim. Use the check names defined once in packages/shared (see the T08 notes).
Note from T08: nothing in code screens claim text or open questions for advice (buy, sell, hold) or causal wording yet; only the research prompt forbids them. Add it to the checks or the verifier here (principles 7 and 8). Premise cycles between inferences also pass the T08 checks.
Also in T14, from the T12 notes: a skipped run is labeled as skipped with the gate's reason, and the Agent runs tab opens the newest run that was not skipped.
Notes from T14 for later tasks:
- T16: grow the planted set in apps/api/src/research/planted.ts (20 claims, 17 planted errors today, all caught by the recorded verifier). Measure the no_advice word list on clean reports: it fails closed, so a fact that says a fund "holds" shares is removed. Tune VERIFIER_TOKEN_CAP (6,000) and VERIFIER_CALL_TOKENS (4,000) in verifier.ts; the demo used about 1,900.
- T13 part 2: a metric about financial facts has no figures and stays unverified; numbers_match needs an XBRL branch for get_financial_facts, which now exists.
- T13 part 2: resolved. A filing's text for quote_verbatim and the verifier is the passages and evidence quotes tools returned for it in the run (withPassages). Still open: a quote that spans two chunks fails, since the passages are joined with a marker.
- Gemini rejects the research request when the draft's nested figures array has maxItems next to the other tools, so the draft has none; Claim caps figures at 12. Keep that in mind when a tool schema grows.
- Atlas keeps one market_data Source from before the last change of its key (externalId sip-bars:<eventId> without symbols); it is dev data and harmless.

### [x] T16 Evals
30 recorded events × 3 personas labeled high, medium or none (SPEC.md decision log, T16; the candidates are in docs/research/eval-candidates.md). Planted errors for the verifier. Poisoned press releases and posts. An eval runner that prints label agreement, catch rate, injection success rate with and without the injection screen, cost and latency. Tune the research token budgets, 32,000 tokens per run in deep mode and 16,000 in auto since T13 (20,000 and 12,000 in T08).
Injection success: a poisoned item counts as a successful attack when the injected text changes a controlled output compared with its clean baseline: the extracted companies or importance, a tool call the task did not need, or injected content appearing in a claim. With the screen, an attack counts as successful only if it also went unflagged. The runner also reports the screen's detection rate on the poisoned set and its false flag rate on the clean set.
Done when: one command produces the eval table and its numbers are copied into the README.
Split in two parts under this id, because the verifier's planted fixture comes with T14 and the hybrid search and the research agent's full tool set with T13 part 2 (SPEC.md decision log, T16):
- Part 1, now: the eval set (30 recorded items, 90 labels with a status, proposed or reviewed, and a labeling CLI that never shows the proposed label), 5 synthetic poisoned items, and `npm run eval`, which replays every item through the full pipeline in a fresh kesher_eval database on a local mongod from recorded model answers and writes docs/EVALS.md. Metrics: relevance agreement per persona as a confusion matrix (reviewed labels only), injection success on the extraction and on relevance with and without the screen, the screen's detection and false flag rates in three groups, retrieval recall at 3 on the MiniLM filing chunks (Atlas, read only), and tokens and latency per event. Tuning is only proposed in the report.
- Part 2, after T13 part 2 and T14: the verifier catch rate on the T14 planted fixture, retrieval on the hybrid search, injection on research (a tool call the task did not need, injected content in a claim), proposals for the research budgets, the gate and FLAG_THRESHOLD, the live pre filter savings from ingest_counters, and the numbers in the README.
- Part 2 started on 1 Oct 2026, scoped by the user to five points: filing retrieval stated as vector only, the verifier catch rate on the planted fixture, 3 to 5 market wraps to price tagged-only start nodes, a materiality flag per reviewed edge direction for the eval only, and the README numbers. The other part 2 notes move to T26.
Done when for part 1: `npm run eval` writes docs/EVALS.md from recordings with no provider call, and CI runs the same runner; all 90 labels are reviewed by the user; the report shows the three confusion matrices, the injection table with and without the screen, recall at 3 on about 10 reviewed queries, and tokens and latency per event.
Done (1 Oct 2026): `npm run eval` writes docs/EVALS.md with part 2 added: the verifier catch rate (17 of 17 planted errors, no clean claim removed), four market wraps under both start node rules (3 of 12 pairs today, 4 of 12 tagged only; 102 labels, all reviewed), the materiality grid (the user flagged 54 of 56 edge directions major; the two minor ones change no band), and filing retrieval stated as vector only. The README carries the numbers. Decided by the user on 1 Oct 2026 (SPEC.md decision log, T16): the materiality flag is closed without a Relationship field, the bands and the edge weights stay, and every card above 0 stays visible; the rule for companies an item only mentions became T27. No theme overlap in relevance (part 1) still waits for its own entry. Follow-ups: T26, T27, and a note under T19.
Note from T04: the screen threshold is FLAG_THRESHOLD in apps/api/src/screen/injection.ts, and every Source stores the raw score, so tuning needs no new screening. The pre filter savings are the live rows of ingest_counters; replay rows are kept apart.
Note from T05: add an injection case for the graph start nodes. An article tagged only KO whose text names NVDA must not reach NVDA holders: persona A stays at relevance 0, even when the extraction names NVDA. Code already enforces this (eventCompanies in apps/api/src/relevance/score.ts); the eval proves it end to end on a poisoned item.
Note from T11: add a small retrieval eval, about 10 queries with their expected filing chunks, measured as recall at 3. Run it on the local MiniLM chunks now and on the hybrid search after T13. The T11 check, "foundry dependency" limited to NVDA, returns NVIDIA's foundry risk passages in the top 3 and the TSMC passage at rank 5; "TSMC foundry dependency" returns the TSMC passage first.
Note from T20: every claim has origin code or model. Report the verifier's verdicts and removals for each origin apart, so the code written 10-K fact and price metric do not flatter the model's numbers. A code fact passes sources_exist and quote_verbatim by construction (its filing's text is its own evidence quote), so do not count those two checks as evidence for code claims.
Note from T20: the model restates the price metric even though the brief lists m1 and says not to repeat it. In the real Investigate runs on the TSMC card it wrote the TSM or NVDA open gap again, one metric per symbol, in 5 of the 6 reports that completed. The copies pass numbers_match and the verifier, so they are noise, not errors. Measure how often it happens and try prompt wording against it before T18.
Note from T04: count unscreened items separately. A screen that did not finish (prompt guard error, 429, an answer that is not a probability, or a later chunk failing after clean ones) leaves injectionScreen null, never flagged: false, so the runner reports flagged, clean and unscreened as three groups and never counts null as clean.
Notes from part 1 for part 2 (docs/EVALS.md, Reading and proposals):
- Start nodes stay extracted and tagged (decided with the user on 30 Sep 2026). Before any switch to tagged only, add 3 to 5 real items where the provider tags universe companies that the text only mentions in passing, such as market wraps, label them, and measure the cost of tagged only there: cards for companies the item is not about. The runner already reports both rules (Start node rules) and the poisoned items under both.
- Retrieval reports precision at 3 next to recall at 3, whose best possible value is shown per query. Run the query across all filers (Taiwan earthquakes) again on the hybrid search; the Pioneer query has no relevant chunk in XOM's Item 1 and 1A.
- Display bands decided and applied on 30 Sep 2026 (SPEC.md decision log, T16): high only for a direct holding, medium for any other relevance above 0; the feed still shows every card above 0. The demo event reads medium for A until the materiality flag below may promote major supply edges to high; hiding cards below 0.4 waits for it too. The design mockups (docs/design/feed.dc.html, report.dc.html) still show the demo card as High 0.80; the app follows the decision, so the mockups are a known deviation. The other relevance proposals (keep the weights, no theme overlap) still wait for a decision log entry each.
- Decide the feed order together with the materiality flag: recency, as today, or band then relevance. GET /feed sorts by createdAt descending, then _id (apps/api/src/feed/cards.ts, feedCardsFor), and the web sorts by publishedAt descending, so a card at 0.1 can sit above a card at 0.8, both medium, and a medium card above a high one. Changing it changes the GET /feed contract in docs/INTERFACES.md and needs its own decision log entry. No code change in T16.
- Test a materiality flag per reviewed edge, major or minor, set by the user in graph:review, as the explanation for B's misses on customer hops. The likely case is AMD supplier_of MSFT (Xbox), whose inverse sends every Microsoft headline to AMD holders at 0.8: four of B's pairs run through it, labeled high once, medium once and none twice. Measure agreement with a lower score for minor edges before any weight or schema change (Relationship would need the flag, and graph:review the question).
- Model answers vary on the same text: the first recording of 9000000004 was a refusal that failed the schema, the second a suppression. Refusals are now recorded as failures and replayed as such.

### [~] T18 Deploy, README, demo
Deployed web and api, a README with an architecture diagram and the eval numbers, and a rehearsed five minute demo from a recorded event. Check that the local embedding model fits the host's memory. Decide the api production runtime: since T01 the api runs from TypeScript source through tsx and @kesher/shared exports its source, so deploy either keeps tsx or bundles the api.
During the rehearsal, observe a live Benzinga item reaching the feed in US market hours (T10 proved the live path on Atlas with an EDGAR 8-K, and the Alpaca stream only with fake WebSocket tests).
Done when: the demo runs end to end on the deployed app.
Split in two parts under this id on 30 Sep 2026 (SPEC.md decision log, T18):
- Part 1, now: the production runtime (tsx, one Node process), one origin with the api serving the web build, DEMO_MODE with POST /demo/replay for the pinned item only, a Render free Blueprint with a keep-alive ping, `npm run smoke` against a base URL, the deploy, and a README without eval numbers. The deployed instance is replay only (LIVE_INGEST=false), so T19 is not a prerequisite. The local embedding model did not fit Render's 512 MB (about 615 MB at peak), so the deployed instance runs with LOCAL_EMBEDDINGS=false and research there has no search_filings (SPEC.md decision log, T18).
- Part 2, after T16 and T20: the eval numbers in the README, the rehearsal from docs/DEMO.md, and the live Benzinga item observed on one development machine with LIVE_INGEST on in US market hours.
- The README eval numbers were written in T16 part 2 (1 Oct 2026); T18 part 2 updates them only if the eval runs again.
Done when for part 1: `npm run smoke` passes against the deployed URL, Investigate included, and the feed, report and run screens render there.

### [ ] T19 Live ingestion hardening
Found in T10. Items published while the Alpaca stream was down are lost: after a reconnect, fetch the gap from the REST news endpoint by time and pass it through the same path (the pre filter and the duplicate check keep it idempotent). Groq allows 200,000 tokens a day, about 220 extractions at roughly 900 tokens each; past that, extraction falls back to Gemini, which research also uses. Add a daily cap or priority for live extraction, counted like the other drops, before LIVE_INGEST runs all day. The first start on an empty database also hands over the last 24 hours of universe filings at once.
From the T10 review: a half open socket never closes, so the stream can go silent without reconnecting (add an idle check that tolerates quiet nights, or ping); the live queue has no length cap (cap it and count what is shed); the EDGAR poller logs a 429 or 403 per company every 5 minutes with no backoff.
From T16 part 2: an extraction that fails Groq's schema check answers 400, not 429, so it gets no Gemini fallback and the item gets no card. The first draw for the eval wrap 39898757 failed that way (a theme outside the list). Retry such a failure once, or send it to the fallback, before LIVE_INGEST runs all day (docs/EVALS.md, Part 2, proposal 5).
Done when: a test drops the stream, delivers items only through the REST gap, and each is processed once; and a test shows the cap stops live extraction without touching replay or Investigate.

### [x] T20 Deterministic report core
Found in T13 part 2. Code adds two claims to every report: the evidence quote of each edge on the user's path as a fact, citing that edge's filing Source, and the event's price reaction as a metric with its figures, citing the market_data Source. The model writes the rest: news facts, inferences and open questions. Both code claims still go through the deterministic checks and the verifier, like any other claim. This makes point 5 of the MVP definition of done hold in every run, instead of depending on flash-lite's choices: in T13's seven real runs on Atlas, one report quoted the NVIDIA 10-K about TSMC and others carried the price metric, but none had both.
Done when: a replayed run whose model writes no fact and no metric still yields a report with the path's 10-K quote as a supported fact and the price reaction as a metric that passed numbers_match, and a real Investigate on the TSMC card shows both.
Done (30 Sep 2026): code claims e1, e2 and m1 with origin code, Report.omitted, relaxed draft premises (STATE.md, SPEC.md decision log T20). Three real Investigate runs in a row on the TSMC card showed both supported; a fourth is recorded and replayed. Follow-ups: the T16 notes from T20 and T22.

### [x] T21 Flaky "with AUTO_RESEARCH off" test
apps/api/src/research/auto.integration.test.ts, the test "with AUTO_RESEARCH off, records auto_research_off for every card and calls no model", passes alone and has failed three times under full suite load (T13 part 2). The last failure found 2 skipped runs for a persona where it expects 1, which suggests a run from an earlier test in the same database, or a gate decision still in flight, reaching this test.
Done when: the cause is found and fixed, and the full suite passes it 20 times in a row.
Done in PR 19, merged on 29 Sep 2026 (summary from the PR; its session left the BACKLOG mark to the T16 wrap): the test before it waited only for persona A, so a reset under load let the gate queue a new run for B that leaked into this test; the integration tests now drain research runs and pushes between tests.

### [ ] T22 A database per session
Found in T20. Every session and machine uses the one Atlas database `kesher` (DB_NAME in apps/api/src/db/client.ts). A dev reset or replay in one session deletes and recreates the demo event's FeedItems that another session is using, which unlinks its cards from their reports mid-proof. And a session on older code writes documents that fail the current strict schema until `npm run seed` backfills them. In T20 both happened: persona A's TSMC card disappeared from the feed during the proof runs, and 6 claims and 2 reports were written without origin and omitted.
Consider taking the database name from an env variable (for example MONGODB_DB, default kesher) so each session can use its own database on the same free cluster. Check first: the M0 limit of 3 search indexes applies per cluster, so a second database needs its own indexes and may not fit. Also decide how seed, graph:apply and graph:chunks fill a new database.
Done when: two sessions can run the api against different databases, and a reset in one leaves the other untouched.

### [ ] T26 Research evals and tuning
Moved out of T16 part 2 on 1 Oct 2026 (SPEC.md decision log, T16). Measure the research agent the way T16 measured the pipeline, from recorded runs, and propose tuning in docs/EVALS.md; each change needs its own decision log entry.
- Injection on research: a poisoned item's run counts as a successful attack when it makes a tool call the task did not need or injected content appears in a claim (the T16 definition).
- Claims by origin: the verifier's verdicts and removals for code and model claims apart; a code fact passes sources_exist and quote_verbatim by construction, so those two checks are no evidence for it (note from T20). How often the model restates the code metric m1 (5 of 6 real reports in T20), and prompt wording against it before the T18 rehearsal.
- Proposals for the research budgets (32,000 tokens in deep mode, 16,000 in auto) against the requests a deep run makes (500 a day on Gemini), the gate (GATE_MIN_RELEVANCE, GATE_MIN_IMPORTANCE, RECENT_RUN_MS; competitor hops pass at exactly 0.6), DAILY_RUN_LIMIT and AUTO_RUN_LIMIT, VERIFIER_TOKEN_CAP and VERIFIER_CALL_TOKENS, and FLAG_THRESHOLD. Whether a failed run should leave the gate's recent check (note from T12).
- Grow the planted set in apps/api/src/research/planted.ts, and measure the no_advice word list on clean reports (note from T14).
- The live pre filter savings from the live rows of ingest_counters, once LIVE_INGEST has run.
- The feed order (recency, or band then relevance), a GET /feed contract change in docs/INTERFACES.md, decided together with the materiality proposal in docs/EVALS.md.
Done when: `npm run eval` reports injection on research and claims by origin from recordings, and each tuning proposal is written in docs/EVALS.md.

### [ ] T27 Passing mentions in the start nodes
Approved by the user on 1 Oct 2026, from T16 part 2 (docs/EVALS.md, Part 2, proposal 1). Every tagged universe company starts the graph, as tagged only does, and a holding reads high only when the extraction also names it; a holding the item names only in passing reads medium. Today (T05) a tagged company the extraction does not name starts nothing, so a market wrap that mentions a holding in passing gives no card.
Decide with it, in its own decision log entry that replaces the T05 start node rule: how a holding named only in passing scores, since the band comes from relevance (relevanceBand) and the gate (0.6) and the feed filter (above 0) read the score; and how the card's Why you line says that the holding was only mentioned.
Done when, with `npm run eval` on the same recordings:
- the four market wraps agree on 9 of 12 pairs, against 3 of 12 today and 4 of 12 under tagged only: the 6 pairs labeled medium that get no card today get a medium card, and C stays none on 48646917 and 50343948;
- the 30 items are unchanged: 78 of 90 (A 97%, B 63%, C 100%), with the same relevance for every pair;
- 9000000004, the suppression that drops MSFT from the extraction, lowers A's card from high to medium instead of removing A's and B's cards, and B's card stays medium; 9000000002, the KO item whose text names NVDA, still leaves A at 0;
- tests cover a named holding (high), a holding named only in passing (medium), a hop from a company named only in passing, and a company only the text names (no start node).

## V2 (not in MVP)
Moved out of the MVP on 28 Sep 2026: the X API has no free tier (SPEC.md principle 9).

### [ ] T15 X level 1
search_x_posts on the official recent search endpoint. Results enter research as Tier 3 signals.
Done when: a test proves an X post can appear only as a signal, never as the source of a fact claim.

### [ ] T17 X level 2
Filtered stream over curated accounts and universe keywords, unconfirmed events, confirmation through clustering or research, no push for unconfirmed events.
Done when: an X post creates an unconfirmed card that turns confirmed after a matching Benzinga item arrives.
