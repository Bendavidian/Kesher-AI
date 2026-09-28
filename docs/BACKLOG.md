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

### [ ] T02 Domain model and seed
Types and zod schemas in packages/shared for every entity in SPEC.md, Mongo collections and indexes, and a seed script for the three personas, the demo universe and five hand written edges with evidence.
Company has primaryListing next to symbol. Every relationship is stored in both directions with its inverse type (supplier_of with customer_of, competitor_of both ways). The seed config holds DEMO_SOURCE_ID=38062166. Vector indexes use 384 dimensions, cosine.
Done when: the seed runs twice without duplicates, and a test validates every seeded document against its schema.

### [ ] T03 Replay ingestion
POST /dev/replay/:sourceId loads one recorded or historical item, stores a Source and creates a MarketEvent through the same path live items will use. Replay selects items by id, never by keyword.
Done when: replaying DEMO_SOURCE_ID (Alpaca news 38062166) creates exactly one Source and one MarketEvent.

### [ ] T04 Extraction, thin
Order: pre filter, then the injection screen, then extraction.
Pre filter, code only: an item passes only when its provider symbols (Alpaca news symbols, EDGAR filer CIK) include a demo universe company. SPY and SMH alone do not pass, and items with no symbols are dropped. A source id that was already processed is not extracted again; an update to it is logged. Every dropped item is counted by reason: not in universe, duplicate, update.
Injection screen: untrusted text goes through Groq meta-llama/llama-prompt-guard-2-86m, long texts in short chunks, and the result is stored on the Source. Flagged items get a label and stay visible; the screen never decides relevance, gating or writes.
Extraction: one structured call on Groq openai/gpt-oss-120b with low reasoning effort, validated with zod: companies with per entity impact, event type, themes, importance with the rubric in SPEC.md. The model gets no tools, and the article is passed as quoted data.
A shared model client with a limiter that respects each provider's tokens per minute. Single calls (extraction, later the verifier) fall back to Gemini gemini-3.5-flash-lite per call on a 429. The client also picks one provider for a whole run, used by T08. A smaller Groq model does not help: openai/gpt-oss-20b and qwen/qwen3.8-27b have the same limits as gpt-oss-120b.
Done when: a unit test on a recorded model response extracts TSM from the TSMC item with importance of at least 3; tests cover each pre filter drop reason and its counter; a flagged item keeps its label and still reaches extraction; and a Groq 429 sends that single call to Gemini.

### [ ] T05 Relevance, thin
Graph propagation up to 2 hops with $graphLookup, scoring per SPEC.md, the path saved on the FeedItem, "Why you" rendered from templates.
Done when: a deterministic test gives the TSMC event high relevance for persona B (direct), high for persona A (supplier path) and none for persona C, and a second test proves traversal in both directions: news about AMD reaches persona A through NVDA competitor_of, and news about NVDA reaches a TSM holder through customer_of.

### [ ] T06 Live feed with persona switcher
Web feed with cards pushed over Socket.IO, and login as any of the three personas.
Build to docs/UI.md, including the one column layout below 1280px. docs/design/feed.dc.html is markup reference only; it needs the design canvas runtime and does not run on its own. The real spike values shown in the design (the demo headline, the 10-K quote and the anchored price moves) are fixtures for the replay demo and its tests.
Done when: replaying the TSMC event updates three open browser sessions with three different cards.

### [ ] T07 MCP server, thin
packages/mcp with get_event and search_news, and run token verification with user and tool scopes.
Done when: a test proves that a token without search_news is rejected, and no tool accepts a user id argument.

### [ ] T08 Research agent, thin
The Investigate button starts a run. The agent calls the two tools within a step budget and a token budget (6,000 tokens per run to start) and returns claims as JSON. Model calls go through the limiter from T04. The run picks its provider once at the start: Gemini gemini-3.5-flash-lite, or Groq openai/gpt-oss-120b for the whole run if Gemini is over its limit. It never switches mid-run; on a 429 inside the run the limiter waits and retries. Tokens, provider and model are recorded per step in the AgentRun. A basic deterministic check confirms each quote appears in its source. The report attaches to the card, which renders a basic report view with claims and sources; T14 completes it to docs/UI.md.
Done when: Investigate on the TSMC card returns a report in which every fact claim has a source id and a verified quote, and a test shows that a 429 in the middle of a run is retried on the same provider.

### [ ] T09 Agent Runs view, thin
A timeline of one run: trigger, steps, tool calls with latency, sources, check results, token usage.
Build to docs/UI.md. docs/design/agent-run.dc.html is markup reference only; it needs the design canvas runtime and does not run on its own.
Done when: the run from T08 is fully inspectable from its card.

## Phase 2: deepen

### [ ] T10 Live ingestion and recording
Alpaca news WebSocket and an EDGAR poller for the universe. Every live item is recorded for replay. The free Alpaca plan allows one live WebSocket, so live ingestion runs only where LIVE_INGEST is on, which is one machine only.
Done when: a live news item reaches the feed without manual action and can be replayed later.

### [ ] T11 Graph build job
Finnhub peers and profiles. LLM extraction of supplier and customer edges from 10-K sections with verbatim quotes. A review CLI to accept or reject edges. The same sections chunked and embedded into FilingChunk.
Peers are kept only inside the demo universe. Every edge is written in both directions with its inverse type. primaryListing comes from the Finnhub profile (check ASML as well as TSM). Chunks of at most 256 tokens, embedded with local Xenova/all-MiniLM-L6-v2 (384 dimensions).
Done when: at least 40 reviewed edges with evidence exist, and filing search returns the NVIDIA foundry passage for "foundry dependency".

### [ ] T12 Gate policy and automatic research
The gate from SPEC.md: relevance threshold, importance of at least 4, dedupe per event cluster, daily budget. Cards appear immediately and research attaches asynchronously.
Done when: tests cover every gate condition, and a card is visible before its research completes.

### [ ] T13 Full MCP tool set
Every tool in INTERFACES.md, a tool set per agent, and get_price_reaction with benchmarks and the delayed flag. Windows are anchored to the regular session through the Alpaca market calendar, and the result states its anchor. search_filings returns at most 3 chunks per call.
Done when: each agent's token lists only its own tools, and get_price_reaction returns stock and benchmark moves for the TSMC window anchored to the previous close, and a test covers a weekend, a holiday and an early close headline.

### [ ] T14 Full verification
Typed claims (fact, metric, inference), deterministic checks, an independent verifier agent. Unsupported facts are dropped, and inferences appear only with supported premises.
The research report screen is completed to docs/UI.md: claim type chips, statuses, the supported and removed bar, the removed claim block and the sources panel. docs/design/report.dc.html is markup reference only; it needs the design canvas runtime and does not run on its own.
Done when: every planted error in a fixture report is caught, and the rendered report contains only supported claims.

### [ ] T16 Evals
20 recorded events × 3 personas labeled high, medium or none. Planted errors for the verifier. Poisoned press releases and posts. An eval runner that prints label agreement, catch rate, injection success rate with and without the injection screen, cost and latency. Tune the research token budget, which starts at 6,000 tokens per run.
Injection success: a poisoned item counts as a successful attack when the injected text changes a controlled output compared with its clean baseline: the extracted companies or importance, a tool call the task did not need, or injected content appearing in a claim. With the screen, an attack counts as successful only if it also went unflagged. The runner also reports the screen's detection rate on the poisoned set and its false flag rate on the clean set.
Done when: one command produces the eval table and its numbers are copied into the README.

### [ ] T18 Deploy, README, demo
Deployed web and api, a README with an architecture diagram and the eval numbers, and a rehearsed five minute demo from a recorded event. The deployed instance becomes the single live ingester (LIVE_INGEST on there, off on both development machines). Check that the local embedding model fits the host's memory. Decide the api production runtime: since T01 the api runs from TypeScript source through tsx and @kesher/shared exports its source, so deploy either keeps tsx or bundles the api.
Done when: the demo runs end to end on the deployed app.

## V2 (not in MVP)
Moved out of the MVP on 28 Sep 2026: the X API has no free tier (SPEC.md principle 9).

### [ ] T15 X level 1
search_x_posts on the official recent search endpoint. Results enter research as Tier 3 signals.
Done when: a test proves an X post can appear only as a signal, never as the source of a fact claim.

### [ ] T17 X level 2
Filtered stream over curated accounts and universe keywords, unconfirmed events, confirmation through clustering or research, no push for unconfirmed events.
Done when: an X post creates an unconfirmed card that turns confirmed after a matching Benzinga item arrives.
