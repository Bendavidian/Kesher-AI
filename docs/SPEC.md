# Kesher AI: Specification v3

Agreed design as of 27 Sep 2026. Change a decision only through the decision log at the bottom.

## Vision
A real time market intelligence system that learns a user's portfolio and interests, monitors market news and SEC filings (X in V2), and surfaces the events that matter to that specific investor, including events linked to their holdings only indirectly. Every event carries an exact explanation of why it reached this user. Significant events get agent driven research whose claims are verified before the user sees them.

## Principles
1. The model understands, the code decides, the model explains.
2. Agents appear only where the next step depends on what they find.
3. No model generated number drives logic.
4. No evidence, no edge.
5. Identity comes from the auth context, never from a model filled argument.
6. External content is untrusted data, never instructions.
7. Temporal association, not causality, unless a source states the cause.
8. Information, not advice.
9. Zero extra spend. Every external service runs on a free tier; any paid call is a bug.

## MVP definition of done
This demo runs reliably from a recorded event:
1. Three seeded personas exist; one holds NVDA and another holds TSM.
2. A real TSMC headline enters the pipeline, live or replayed.
3. Extraction finds TSMC, and the graph finds TSMC → supplies → NVDA → held by the user.
4. Cards appear live with a deterministic "Why you" line and its source.
5. Investigate runs the research agent through MCP tools: related news, the NVIDIA 10-K and the price reaction.
6. The report arrives as typed claims, and the verifier checks each one.
7. Agent Runs shows the whole run: trigger, gate decision and reason, tool calls with latency, sources, verification results and token cost.
8. Switching personas shows the same event at three levels: high through a direct holding, high through a supplier path, and none.

## Pipeline
```
Event: Alpaca news stream or replay, SEC EDGAR poller
→ Pre filter: universe symbols, dedupe by source id                            [code]
→ Injection screen: a label on the Source, decides nothing                     [classifier]
→ Extract companies, per entity impact, event type, themes, importance 1 to 5  [LLM, structured]
→ Propagate on the interest graph, max 2 hops, weights per edge type           [code, $graphLookup]
→ Relevance, confidence and "Why you" from the exact path                      [code]
→ Research gate: relevance ≥ 0.6, importance ≥ 4, not recent, budget left      [code policy]
→ Research agent with scoped MCP tools and a step budget                       [agent]
→ Claim verification: deterministic checks, then a verifier agent              [code + agent]
→ Card pushed live; research attaches to the same card later                   [Socket.IO]
```
A card is written and pushed as soon as relevance is computed; it never waits for research. Investigate is a second entry point into the same research path. It skips the relevance and importance conditions of the gate but not the budget.

Pre filter, before any model call: an item passes only when its provider symbols (Alpaca news symbols, EDGAR filer CIK) include a demo universe company. SPY and SMH are benchmarks, not universe companies, so an item tagged only with them does not pass. Items with no symbols are dropped in the MVP. A source id that was already processed is not extracted again; an update to it is logged. Every dropped item is counted by reason (not in universe, duplicate, update), so the savings show in the metrics.

Injection screen: Groq meta-llama/llama-prompt-guard-2-86m screens the untrusted text in short chunks, and the result is stored on the Source. A flagged item gets a label and stays visible. The screen never decides relevance, gating or writes (principle 3).

## Scores
| Score | Computed by | Values |
|---|---|---|
| Relevance | code, from graph paths | 0 to 1 |
| Importance | LLM classification against the rubric | 1 routine, 2 low, 3 meaningful, 4 important, 5 major |
| Confidence | code, from source tier and corroboration | high, medium, low |

Relevance, initial rule (tuned in T05 and T16): the maximum over all paths from an event company to a user holding. A direct holding scores 1. One hop scores the edge weight. Two hops score the product of both weights times 0.7. Starting weights: supplier or customer 0.8, competitor 0.6, same sector 0.4, shared theme 0.3.

Confidence rule: high when a Tier 1 source or two independent Tier 2 sources back the event, medium for a single Tier 2 source, low for Tier 3 only.

Importance rubric examples: 1 routine commentary or price target reiterations; 2 minor product or partnership news; 3 guidance mentions, analyst rating changes, notable executive moves; 4 earnings surprises, production disruptions, major contracts, regulatory actions; 5 events that change the business: large acquisitions, bans, fraud, bankruptcy.

## Source tiers
- Tier 1, primary: SEC filings, company IR releases, allowlisted official company accounts on X.
- Tier 2, wires: Benzinga through Alpaca.
- Tier 3, social: all other X posts. They can trigger research and appear as unconfirmed events, and are never evidence for a fact claim.

X is V2, so the MVP has no X sources: Tier 1 is SEC filings and company IR releases, and Tier 3 is empty until X arrives. The tier design and the confidence rule stay unchanged.

## Interest graph
- Nodes: companies in the demo universe, sectors, themes.
- Edge types: holds (per user, from holdings), competitor_of (Finnhub peers, kept only inside the demo universe), in_sector (company profiles), supplier_of and customer_of (LLM extraction from 10-K sections, reviewed by hand), has_theme (fixed taxonomy).
- Every relationship is stored in both directions with its inverse type: supplier_of pairs with customer_of, and competitor_of is symmetric. Traversal then works from either end: news about AMD reaches NVDA holders, and news about NVDA reaches TSM holders.
- Every edge that comes from a document carries evidence: source id, filing date, verbatim quote, URL and a reviewed flag. Unreviewed edges are never used.
- One offline job reads each 10-K once and feeds both the edges and FilingChunk for RAG.
- Foreign issuers such as TSM and ASML file 20-F and 6-K instead of 10-K and 8-K. In the MVP they are graph nodes without filing RAG.
- Traversal uses MongoDB $graphLookup with at most 2 hops.
- Theme taxonomy: ai_accelerators, cloud, chip_design, foundry, semicap_equipment, memory, networking, smartphones, pc, data_centers, energy, oil_gas, consumer_staples, pharma, healthcare, regulation, trade_policy, rates_macro, cybersecurity, autos_ev.

## Demo universe and personas
- AI and cloud: NVDA, MSFT, AMZN, GOOGL, META
- Semiconductors: AMD, AVGO, INTC, QCOM, MU
- Manufacturing and equipment: TSM, ASML, AMAT, LRCX
- Unrelated: KO, JNJ, XOM
- Benchmarks, price only: SPY, SMH

Personas: A, AI investor (NVDA, MSFT, AMZN). B, semiconductor investor (AMD, AVGO, TSM, ASML). C, unrelated investor (KO, JNJ, XOM).

## Research agent
- Input: the event, the user's path and holdings, a step budget (auto mode 6 tool calls, deep mode 15) and a token budget (12,000 tokens per run in auto mode and 20,000 in deep mode, tuned in T16; see the decision log, T08).
- Tools: read only, scoped by the run token. Tool output is capped: at most 3 filing chunks per call.
- Output: typed claims plus open questions, as JSON validated with zod.
- Stops when either budget is spent or every report section has supported claims.
- Every model call goes through a limiter that respects the provider's tokens per minute. Tokens, provider and model are recorded per step in the AgentRun.
- Model: Gemini gemini-3.5-flash-lite, picked once per run, with Groq openai/gpt-oss-120b as the whole run fallback (see Stack).

## Claims and verification
- fact: cites a verbatim quote from a source. The display text may paraphrase it.
- metric: numbers must match market data or XBRL exactly.
- inference: references its premise claims, uses hedged language, and is shown only when every premise is supported.

Order: deterministic checks first (quotes exist verbatim, numbers match, cited sources exist), then the verifier agent (separate context, reads the sources, never sees the research agent's reasoning). Unsupported facts are dropped, never shown as fact.

## MCP tool layer
- Official MCP TypeScript SDK on both server and client, pinned to one version.
- Tools and contracts live in docs/INTERFACES.md.
- For each run the api mints a short lived token (5 minutes) with the user, the agent and its allowed tools. The server derives identity and permissions from the token alone.

## Price reaction
Computed from SIP bars older than 15 minutes, the limit of the free Alpaca plan. Windows are anchored to the regular session. The Alpaca market calendar (GET /v2/calendar) defines the trading days and their open and close, so headlines on weekends, holidays and early close days anchor to the correct trading day.
- Headline during a regular session: the base is the price at the headline. Windows: 15 minutes, 2 hours, session close.
- Headline outside a regular session (overnight, weekend, holiday, after an early close): the base is the previous regular close. Windows: open gap, 15 minutes after the open, 2 hours after the open, session close, all on the next trading day.
- A window that would end after the session close ends at the close.
- The result states the anchor it used: headline or previous close, the base time and the trading day.

Always shown with SMH and SPY in the same windows and labeled as delayed. Example wording, from the demo event: "NVDA opened −1.1% below its previous close after the overnight headline; SMH −1.0%, SPY −0.2%." Never "caused".

## X integration (V2)
Moved to V2 on 28 Sep 2026: the X API has no free tier, which breaks principle 9. The design below is kept for V2.
- Level 1: search_x_posts on the official recent search endpoint. Results enter research as Tier 3 signals.
- Level 2: filtered stream over curated accounts plus universe keywords. Tier 3 posts create unconfirmed events, confirmed when clustering links a Tier 1 or Tier 2 item or when research finds corroboration. No push notifications for unconfirmed events.
- Cost control: no cashtag rules on large caps, a spending limit in the X developer console, post ids stored with links back to X.

## Replay and recording
Live items are recorded from day 2: news, filings and price bars (X posts in V2). The demo and the evals replay recorded events through the same pipeline. Historical Alpaca news, available since 2015, can also be replayed.
- Replay selects items by source id, never by keyword.
- The demo item is pinned: Alpaca news id 38062166, "TSMC Suspends Chip Production After Taiwan Rocked By Strongest Tremor In 25 Years" (2024-04-03T03:57:09Z). The seed config holds it as DEMO_SOURCE_ID=38062166.
- The free Alpaca plan allows one live WebSocket per account, so LIVE_INGEST is on for one machine only; the other works from replay. Once deployed (T18), the deployed instance is the single live ingester.

## Evals
- 20 recorded events × 3 personas, labeled high, medium or none: 60 labels.
- About 10 planted errors for the verifier, and 5 poisoned press releases or posts for injection tests.
- Metrics: label agreement, verifier catch rate, injection success rate before and after defenses and with and without the injection screen, cost and latency per event.

## Domain model
Outline only. T02 turns it into types, zod schemas, collections and indexes.
- User: email, password hash, display name, holdings (embedded: symbol, quantity), interests (themes).
- Company: symbol (the US ticker used for news and prices), primary listing (from the Finnhub profile, for example 2330.TW for TSM), name, CIK, filer type (10-K or 20-F), sector, themes.
- Relationship: from, to, type, weight, evidence (source id, quote, filing date, URL, reviewed). Stored in both directions with the inverse type.
- Source: provider, kind (news, filing, x_post, market_data), tier, external id, URL, author, title, text (the item body as untrusted data, normalized; null for filings, whose text lives in FilingChunk), published at, injection screen result (flag, model).
- MarketEvent: source ids (cluster), headline, companies with per entity impact, event type, themes, importance, status (unconfirmed or confirmed), embedding.
- FeedItem: user, event, relevance, path, confidence, status, research state. Unique per user and event.
- AgentRun: user, event, agent, mode, trigger, gate decision, step budget, token budget, steps (tool, provider and model, input, output summary, output capped at 8 KB after redaction, latency, tokens), tokens used, cost, status, failure reason.
- Report: run, sections with claim ids, open questions.
- Claim: report, type, text, sources with quotes, premises, status, check results.
- FilingChunk: source, symbol, form, section, text (at most 256 tokens), embedding.
- IngestCounter: UTC day, mode (live or replay), drop reason (not in universe, duplicate, update), count. The dropped items themselves are not stored.
- ResearchBudgetDay: UTC day, research runs reserved that day (automatic and Investigate together).

The Atlas free tier allows 3 search indexes: event vectors, filing chunk vectors (both 384 dimensions, cosine), and one text index for hybrid search. Vector scores only rank results; they never act as a threshold that decides anything.

## Stack
- Frontend: React, TypeScript, Vite, Tailwind. Desktop first: the three panel layout targets screens 1280px and wider. Below that, the panels stack in one column in the order feed, event, scores.
- Backend: Node and Express with TypeScript, Socket.IO, an in process job queue.
- Data store: MongoDB Atlas free tier with Vector Search and $graphLookup.
- AI: Vercel AI SDK for model calls, so a provider switch is a config change. Official MCP TypeScript SDK. Models run on the Groq and Google AI Studio free tiers; the limits are in docs/SPIKE.md.
  - Extraction and the verifier: Groq openai/gpt-oss-120b. Each call falls back to Gemini gemini-3.5-flash-lite on a 429. The verifier therefore normally uses a different model family than the research agent.
  - Research agent: Gemini gemini-3.5-flash-lite, which allows 250,000 tokens per minute against 8,000 on Groq. It picks its provider once per run and never switches in the middle of a run; inside a run the limiter waits and retries. If Gemini is over its limit when a run starts, the whole run goes to Groq openai/gpt-oss-120b.
  - The AgentRun records the provider and model of every step.
  - Groq's 200,000 tokens per day is the real ceiling for extraction. The deterministic pre filter stays in front of the model, and extraction uses low reasoning effort. openai/gpt-oss-20b and qwen/qwen3.8-27b have the same limits, so a smaller Groq model does not help.
  - Injection screen: Groq meta-llama/llama-prompt-guard-2-86m (see Pipeline).
- Embeddings: local Xenova/all-MiniLM-L6-v2 through @huggingface/transformers, 384 dimensions, cosine; no key and no quota. Upgrade path: Gemini gemini-embedding-2 at 768 dimensions.
- Data sources: Alpaca (news stream, news history, SIP bars, market calendar), Finnhub (peers, profiles), SEC EDGAR (filings, XBRL), all on free tiers. X API in V2.

## UI
A dark trading terminal, approved 28 Sep 2026. docs/UI.md is the source of truth for the tokens, type, layout and the three screens: feed, research report and agent run. The Tailwind theme defines the tokens, and components never hardcode hex values. docs/design/*.dc.html are markup references only; they need the design canvas runtime and do not run on their own.

The real spike values shown in the designs are fixtures for the replay demo and its tests: the demo headline (Alpaca news 38062166), the NVIDIA 10-K quote about TSMC, and the price moves anchored to the previous close (docs/SPIKE.md checks 1 and 3). Other numbers in the designs are illustrative.

## Build order
Walking skeleton T01 to T09 by the end of day 3 (docs/BACKLOG.md). Days 4 to 8 deepen each stage, days 9 and 10 cover evals and personas, then deployment, rehearsal and buffer.

## Out of scope (V2)
Thesis guardian, BullMQ and Redis, full PWA, fund look through exposure, Israeli market data, MCP Apps, price anomaly detection, filing RAG for foreign issuers, X level 1 and level 2, a paid Anthropic API key as the LLM upgrade path, relevance from themes alone for items with no symbols.

## Decision log
- 27 Sep 2026: Name is Kesher AI. Solo build, two weeks.
- 27 Sep 2026: Relevance, the research gate and all writes are deterministic. Importance is a 1 to 5 classification.
- 27 Sep 2026: Claims are typed. A verifier agent runs after deterministic checks.
- 27 Sep 2026: Source tiers and computed confidence. X is a Tier 3 signal, integrated in two levels.
- 27 Sep 2026: Demo and evals run on recorded events. Three personas are the core demo.
- 27 Sep 2026: Development in the Claude Code desktop app; the repo is the source of truth for tasks and state.
- 28 Sep 2026: Zero extra spend. Every external service runs on a free tier; any paid call is a bug (principle 9).
- 28 Sep 2026: LLM providers on free tiers through the Vercel AI SDK. Groq is primary for extraction, research and verification; Gemini Flash-Lite (Google AI Studio free tier) is the backup for extraction. A paid Anthropic API key is the documented V2 upgrade path.
- 28 Sep 2026: X moves to V2, both levels, because its API has no free tier. The source tier design is kept. Supersedes the X decision of 27 Sep.
- 28 Sep 2026 (T00 finding A): Price reaction windows are anchored to the regular session, using the Alpaca market calendar for weekends, holidays and early closes. get_price_reaction returns the anchor it used. Replaces the fixed 15 minute, 2 hour and 1 day windows from the headline.
- 28 Sep 2026 (T00 finding B): Company keeps symbol as the US ticker and adds primary listing, because Finnhub profiles return the home listing (2330.TW for TSM).
- 28 Sep 2026 (T00 finding C): competitor_of edges come from Finnhub peers filtered to the demo universe. Every relationship is stored in both directions with its inverse type: supplier_of pairs with customer_of, and competitor_of is symmetric.
- 28 Sep 2026 (T00 finding D): LIVE_INGEST is on for one machine only, because the free Alpaca plan allows one live WebSocket. After T18 the deployed instance is the single live ingester.
- 28 Sep 2026 (T00 finding E): Each research run gets a token budget next to its step budget, starting at 6,000 tokens and tuned in T16. A limiter respects each provider's tokens per minute. Tool output is capped at 3 filing chunks per call. Tokens are recorded per step in the AgentRun. The research model is decided after the console quotas are recorded; Gemini Flash-Lite stays the fallback on a 429.
- 28 Sep 2026 (T00 finding F): Embeddings use local Xenova/all-MiniLM-L6-v2, 384 dimensions, cosine, with filing chunks of at most 256 tokens. Gemini gemini-embedding-2 at 768 dimensions is the documented upgrade path.
- 28 Sep 2026: The demo item is pinned by id: Alpaca news 38062166, DEMO_SOURCE_ID in the seed config. Replay selects items by id, never by keyword.
- 28 Sep 2026 (console numbers): Model split. The research agent runs on Gemini gemini-3.5-flash-lite (250,000 tokens per minute against 8,000 on Groq). It picks its provider once per run and never switches mid-run; inside a run the limiter waits and retries. If Gemini is over its limit when a run starts, the whole run goes to Groq openai/gpt-oss-120b. Extraction and the verifier run on Groq openai/gpt-oss-120b and fall back to Gemini per call on a 429, so the verifier normally uses a different model family than the research agent. The AgentRun records provider and model per step. Closes the research model decision from finding E and replaces "Groq is primary for extraction, research and verification".
- 28 Sep 2026: A deterministic pre filter runs before any model call, because Groq's 200,000 tokens per day is the real ceiling for extraction. It passes only items whose provider symbols include a demo universe company (SPY or SMH alone do not count), drops items with no symbols, never extracts a source id twice and logs updates to it, and counts every drop by reason. Relevance from themes alone moves to V2. Order: pre filter, then the injection screen, then extraction.
- 28 Sep 2026: Injection screen. Groq meta-llama/llama-prompt-guard-2-86m screens untrusted text in short chunks before extraction and stores its result on the Source. Flagged items get a label and stay visible; the screen never decides relevance, gating or writes, so principle 3 holds. T16 reports the injection success rate with and without it.
- 28 Sep 2026: Dark trading terminal UI, tokens in docs/UI.md. docs/design/*.dc.html are markup references only. The real spike values in the designs (demo headline, 10-K quote, anchored price moves) are fixtures for the replay demo and its tests.
- 28 Sep 2026: Desktop first. The three panel layout targets screens 1280px and wider; below that, the panels stack in one column in the order feed, event, scores. Replaces mobile first.
- 28 Sep 2026: TypeScript on the MERN stack. It is JavaScript with types, chosen for type safety across the shared schemas and because it is the industry standard for this stack.
- 28 Sep 2026 (T02): holds is derived from User.holdings and never stored as a Relationship. Stored edge types are supplier_of, customer_of and competitor_of, and each requires filing evidence (principle 4). Sector and themes stay fields on Company until T11 decides on in_sector and has_theme edges and on evidence for Finnhub peers.
- 28 Sep 2026 (T02): Every document _id is a string UUID and natural keys have unique indexes, so the shared schemas stay free of bson and the seed is idempotent. Source.injectionScreen also keeps the classifier score (nullable); it decides nothing and lets T16 tune the threshold without screening again.
- 28 Sep 2026 (T02): The three personas share one public demo password, since the persona switcher is a demo control (docs/UI.md). Only its scrypt hash is stored.
- 28 Sep 2026 (T03): Source keeps the item body in text, normalized the way the seeded quotes are (packages/shared normalizeText), so the injection screen, extraction and the quote checks read one field by source id. Filings keep text null; their text lives in FilingChunk.
- 28 Sep 2026 (T03): Recordings are committed JSON files, recordings/<provider>/<id>.json, holding the raw provider item without the full article content. Replay reads them by id, so the demo and the evals never depend on a provider being up. The Alpaca history endpoint has no id filter, so `npm run record` looks the item up in one symbol's news for one day and selects it by id. T10 decides whether live recordings on the deployed instance use the same files or a collection.
- 28 Sep 2026 (T04): An item dropped as not in universe is not stored at all, neither Source nor MarketEvent; only its counter grows. Drop counters live in the ingest_counters collection, one document per UTC day, mode and reason. Mode is live or replay, so replays never inflate the savings.
- 28 Sep 2026 (T04): An item counts as processed once its event has an extraction. Sent again unchanged it is a duplicate; sent with changed provider fields it is an update, logged with the field names only and counted. The stored Source is never overwritten (ingestItem is insert only), so its text always matches its injection screen and extraction. An item whose screen or extraction did not finish resumes on the next try and is not counted.
- 28 Sep 2026 (T04): The injection screen flags at a prompt guard score of 0.5 or more (FLAG_THRESHOLD, tuned in T16), taking the highest score over chunks of at most 1,200 characters. It fails open: if prompt guard fails, the Source keeps no label, the failure is logged, and extraction still runs, because a screen that decides nothing must not gate through its outages either.
- 28 Sep 2026 (T04): Model keys are read lazily. The api starts without GROQ_API_KEY or GOOGLE_GENERATIVE_AI_API_KEY; a call that needs a missing key fails naming it, and POST /dev/replay answers 503. Dropped and already processed items need no key. Replay runs the pipeline inline; T10 adds the job queue for live items.
- 28 Sep 2026 (T07): The MCP layer uses the official TypeScript SDK v2 (`@modelcontextprotocol/server` and `/client`, pinned at 2.1.0), which replaces the monolithic v1 package and builds on zod 4. The server is mounted in the api at POST /mcp as stateless Streamable HTTP, and the research agent reaches it as a real MCP client with the run token as a Bearer token. Run tokens are HS256 JWTs with a fixed 5 minute lifetime. Each request builds a server that registers only the tools its token lists.
- 28 Sep 2026 (T07): search_news starts thin: a keyword match over news Sources ranked by code (distinct words matched, then recency), because the hybrid search needs the Atlas text index and event embeddings. T13 replaces it behind the same contract.
- 28 Sep 2026 (T05): Propagation loads the reviewed edges within 2 hops of the event companies with one $graphLookup per event. Relevance is the maximum over all paths, with the SPEC weights read from the stored edge. Ties go to fewer hops, then to a fixed order of event company, holding and edge ids, so the same graph always gives the same path. No path visits a company twice.
- 28 Sep 2026 (T05): The graph starts only from extracted companies that the provider also tagged (Source.symbols) and that are universe companies. The provider tags are the code's check on the model: a company named only in the untrusted text cannot pull relevance for its holders, so an article tagged KO that names NVDA never reaches NVDA holders. The full extraction stays stored; only the start nodes are restricted. This fails closed: a company the text really covers but the provider did not tag gets no path, which T16 can measure on clean items.
- 28 Sep 2026 (T05): Every extracted event gets a FeedItem for every user, relevance 0 included. This differs from design point 1, which stores no FeedItem at relevance 0, and is kept for the MVP: an item counts as processed once its event has an extraction and a FeedItem for every user, so a scoring run that stopped partway resumes on the next try with no model call. This extends the T04 rule. The limit: it writes one document per user for every event. At scale a scoredAt marker on the MarketEvent replaces the relevance 0 items. The feed and every FeedCard list still hide relevance 0.
- 28 Sep 2026 (T05): Confidence counts two Tier 2 sources as independent only when their publishers differ. Source keeps a nullable publisher (Benzinga for Alpaca news, null for filings), and `npm run seed` backfills it on Sources stored before T05.
- 28 Sep 2026 (T05): The FeedCard read model is assembled on the server and carried by GET /feed, feed:item and feed:update (docs/INTERFACES.md). The evidence form is the filer's annual form (Company.filerType), since every reviewed edge quotes the filer's 10-K. "Why you" templates and the placeholder relevance bands (high from 0.8, medium above 0, none at 0) live in packages/shared. The GET /feed route and the socket events land in T06 with login, so the user always comes from the auth context.
- 29 Sep 2026 (T06): The web session is an HS256 JWT in an httpOnly, SameSite=Lax cookie (kesher_session, 12 hours), signed with JWT_SECRET, which is separate from the run token secret. POST /auth/login signs in a seeded persona with the public demo password; the persona switcher is that login. Every route and the Socket.IO handshake take the user from the cookie only. A socket closes when its session expires or its user signs out. Login has no rate limit and a stateless token cannot be revoked before it expires; both are acceptable for the demo personas and revisited before any real accounts.
- 29 Sep 2026 (T06): Persona C's None comes from GET /events/:eventId/explain, which computes the user's relevance and path on request with the same scoring code and writes nothing. No FeedCard list and no card push carries relevance 0. After each scoring run the server sends event:scored with the event id only, to every signed in socket; a client with no card for that event asks explain. So the demo still shows the same event at three levels (DoD point 8) without a relevance 0 feed.
- 29 Sep 2026 (T06): The web's Replay control calls POST /dev/reset/:sourceId, then POST /dev/replay/:sourceId, both development only. Reset deletes only the event's FeedItems, so the replay scores it again with no model call and every open session sees it arrive as feed:item. A replay without a reset stays a duplicate and pushes nothing, as live ingestion would.
- 29 Sep 2026 (T06): FeedCard.priceReaction stays null until T13, and the web then shows a "No price reaction yet" state instead of moves. The anchored price moves from docs/SPIKE.md remain fixtures for the component tests only; no number reaches the screen that the api did not send.
- 29 Sep 2026 (T08): The research token budget is 20,000 tokens per run in deep mode and 8,000 in auto, replacing the 6,000 of finding E. That figure was set when research ran on Groq at 8,000 tokens per minute; research now runs on Gemini at 250,000, and the history is resent on every turn. 1,500 tokens are kept for the report. T16 tunes both. The step budget counts tool calls, 6 in auto and 15 in deep.
- 29 Sep 2026 (T08): The research loop is code. Each turn is one model call through the limiter, with the MCP tools the run token lists and a local submit_report tool whose input is the claim draft, validated with zod. The model executes nothing: code runs each tool call through MCP and passes the output back inside <tool_output> tags as untrusted data. Code plans every turn: a tool turn starts only when its prompt and output cap fit and a report can still follow it; otherwise code forces submit_report, and when not even a minimal report fits the run ends as budget_exhausted. Every step is written to the AgentRun as it happens, its output redacted and then capped at 8 KB.
- 29 Sep 2026 (T08): A 429 inside a run waits on the same provider, honoring retry-after (or Gemini's retryDelay) up to 30 seconds per wait, at most 3 retries. A longer wait, such as a daily quota, or a fourth 429 ends the run as failed with reason rate_limited, recorded as a step, with no report. A daily quota never blocks a run.
- 29 Sep 2026 (T08): The deterministic claim checks run before the verifier exists. A fact whose quote is not found verbatim (after normalizeText) in the title or text of a source a tool returned in this run is removed; one whose quote is found stays unverified until T14. An inference whose premise was removed is removed. A draft claim that cannot form a valid Claim is dropped and logged in the run.
- 29 Sep 2026 (T08): T08 is split under one id, because Investigate needs the auth context from T06. Part 1 builds the agent, its steps, the claims, the checks and the recordings, with a development script (npm run research:dev) that runs persona A on the demo event and mints its own run token. Part 2, after T06, adds POST /events/:eventId/investigate with the user from the auth context, the Investigate button and the basic report on the card.
- 29 Sep 2026 (T08): The auto mode token budget is raised from 8,000 to 12,000 tokens per run, next to 20,000 in deep mode. The first real auto run made one tool call and stopped at 3,157 tokens, because a tool turn starts only when a worst case report can still follow it. T16 still tunes both budgets.
- 29 Sep 2026 (T08): POST /events/:eventId/investigate answers 202 with the card in state running and runs the agent in the background; the card follows it through feed:update, so the card never waits for research. One conditional write moves the FeedItem to running, so two requests never start two runs (409). Investigate again is allowed after done or failed. A run left running for 15 minutes is taken over at the next Investigate instead of being failed at startup, because two machines may share one database. The card links to GET /reports/:reportId, which the report screen reads; run:step and the run screen stay in T09. Closes the open decision on waiting against 202. Since T12 the 202 carries the card queued.
- 29 Sep 2026 (T08): The report screen counts as removed only claims with status removed, in the removed block, the removed chip and the red segments. A claim the display rules cannot back yet stays hidden with a neutral line: an inference whose premises are not supported yet ("1 inference waits for verification"), an inference built on a claim that is not shown, or a claim whose source cannot be listed. Until the verifier (T14) supports facts, every inference waits.
- 29 Sep 2026 (T12): The research gate's open parameters. Relevance at least 0.6 and importance at least 4, as in the Pipeline. "Not recent" means no run for the same user and event cluster (the MarketEvent) that was not skipped in the last 24 hours, whatever its trigger; research is per user, because the brief holds the user's path and holdings. When that recent run has a report and the card shows none, the gate attaches the report to the card with no model call, so a reset and replay in the demo shows it again. The budget is research runs per UTC day, automatic and Investigate together, counted in one document per day that every machine on the database shares, reserved with one atomic conditional $inc: 30 a day, which keeps a worst case deep run (16 model calls) inside Gemini's 500 requests a day, and automatic runs stop at 20 so at least 10 stay for Investigate. A reserved run stays counted even if it never starts. Investigate skips relevance, importance and the recent check (Investigate again stays allowed, T08) and answers 429 once the day's 30 runs are reserved. T16 tunes every threshold and limit. Importance comes from the extraction of untrusted text, so an injected item could raise it to 4 and start a run; the extraction has no tools, the provider tags limit the start nodes (T05), and the budget caps the cost. A failed run counts as recent too, so only Investigate retries it within the 24 hours.
- 29 Sep 2026 (T12): Every gate decision is stored. A skip on a card above relevance 0 writes an AgentRun with trigger gate, status skipped and the reason, with one Gate check step and no model call; relevance 0 writes nothing. Agent Runs shows the gate decision and reason for every card (DoD point 7).
- 29 Sep 2026 (T12): Research runs go through the in process job queue, first in, first out, one run at a time, for the gate and for Investigate, so automatic runs for several users never compete for the provider's per minute limits. The card goes from queued to running to done or failed, and Investigate answers 202 with the card queued. The queue lives in memory: a job lost to a restart leaves its card queued until the 15 minute takeover of T08, which now covers queued as well as running. Scoring pushes the cards first and the gate decides after, so a card never waits for research.
