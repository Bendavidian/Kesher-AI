# Backlog

Status marks: [ ] todo, [~] in progress, [x] done. Task ids are stable; never renumber.
Walking skeleton: T00 to T09 by the end of day 3. Then deepen.

## Phase 0: validation

### [ ] T00 Spike: verify every external dependency
Throwaway scripts in /spike (TypeScript run with tsx). Results in docs/SPIKE.md: pass or fail, evidence, limits observed. Every service on a free tier. Checks run in this order:
1. SEC: fetch NVIDIA's latest 10-K through the submissions API with a declared User-Agent; locate the TSMC foundry passage.
2. Finnhub: peers and profile for NVDA and TSM.
3. Alpaca: receive live news over WebSocket; fetch one historical TSMC news item by symbol and date; SIP bars for NVDA, SMH and SPY in a historical window around that item.
4. Groq: one structured output call. Record latency, token usage and the daily quota shown in the console.
5. Gemini Flash-Lite: one structured output call. Record latency, token usage and the daily quota shown in the console.
6. MongoDB Atlas free tier: create a vector index and run one $graphLookup.
A check whose key is missing reports "skipped: missing key" and does not block the others.
Done when: docs/SPIKE.md covers all six checks with evidence, and every failure comes with a proposed change to SPEC.md.

## Phase 1: walking skeleton, thin and end to end

### [ ] T01 Monorepo scaffold
npm workspaces: apps/web, apps/api, packages/shared, packages/mcp. TypeScript strict, ESLint, Prettier, vitest. Scripts dev, test, typecheck and lint that work on macOS and Windows. A .claude/launch.json with the web and api servers. A GitHub Actions workflow for typecheck and test.
Done when: npm run dev shows the web shell in the Browser pane, GET /health returns ok, and CI passes.

### [ ] T02 Domain model and seed
Types and zod schemas in packages/shared for every entity in SPEC.md, Mongo collections and indexes, and a seed script for the three personas, the demo universe and five hand written edges with evidence.
Done when: the seed runs twice without duplicates, and a test validates every seeded document against its schema.

### [ ] T03 Replay ingestion
POST /dev/replay/:sourceId loads one recorded or historical item, stores a Source and creates a MarketEvent through the same path live items will use.
Done when: replaying the TSMC item creates exactly one Source and one MarketEvent.

### [ ] T04 Extraction, thin
One structured LLM call validated with zod: companies with per entity impact, event type, themes, importance with the rubric in SPEC.md. The model gets no tools, and the article is passed as quoted data.
Done when: a unit test on a recorded model response extracts TSM from the TSMC item with importance of at least 3.

### [ ] T05 Relevance, thin
Graph propagation up to 2 hops with $graphLookup, scoring per SPEC.md, the path saved on the FeedItem, "Why you" rendered from templates.
Done when: a deterministic test gives the TSMC event high relevance for persona B (direct), high for persona A (supplier path) and none for persona C.

### [ ] T06 Live feed with persona switcher
Web feed with cards pushed over Socket.IO, and login as any of the three personas.
Done when: replaying the TSMC event updates three open browser sessions with three different cards.

### [ ] T07 MCP server, thin
packages/mcp with get_event and search_news, and run token verification with user and tool scopes.
Done when: a test proves that a token without search_news is rejected, and no tool accepts a user id argument.

### [ ] T08 Research agent, thin
The Investigate button starts a run. The agent calls the two tools within a step budget and returns claims as JSON. A basic deterministic check confirms each quote appears in its source. The report attaches to the card.
Done when: Investigate on the TSMC card returns a report in which every fact claim has a source id and a verified quote.

### [ ] T09 Agent Runs view, thin
A timeline of one run: trigger, steps, tool calls with latency, sources, check results, token usage.
Done when: the run from T08 is fully inspectable from its card.

## Phase 2: deepen

### [ ] T10 Live ingestion and recording
Alpaca news WebSocket and an EDGAR poller for the universe. Every live item is recorded for replay.
Done when: a live news item reaches the feed without manual action and can be replayed later.

### [ ] T11 Graph build job
Finnhub peers and profiles. LLM extraction of supplier and customer edges from 10-K sections with verbatim quotes. A review CLI to accept or reject edges. The same sections chunked and embedded into FilingChunk.
Done when: at least 40 reviewed edges with evidence exist, and filing search returns the NVIDIA foundry passage for "foundry dependency".

### [ ] T12 Gate policy and automatic research
The gate from SPEC.md: relevance threshold, importance of at least 4, dedupe per event cluster, daily budget. Cards appear immediately and research attaches asynchronously.
Done when: tests cover every gate condition, and a card is visible before its research completes.

### [ ] T13 Full MCP tool set
Every tool in INTERFACES.md, a tool set per agent, and get_price_reaction with benchmarks and the delayed flag.
Done when: each agent's token lists only its own tools, and get_price_reaction returns stock and benchmark moves for the TSMC window.

### [ ] T14 Full verification
Typed claims (fact, metric, inference), deterministic checks, an independent verifier agent. Unsupported facts are dropped, and inferences appear only with supported premises.
Done when: every planted error in a fixture report is caught, and the rendered report contains only supported claims.

### [ ] T16 Evals
20 recorded events × 3 personas labeled high, medium or none. Planted errors for the verifier. Poisoned press releases and posts. An eval runner that prints label agreement, catch rate, injection success rate, cost and latency.
Done when: one command produces the eval table and its numbers are copied into the README.

### [ ] T18 Deploy, README, demo
Deployed web and api, a README with an architecture diagram and the eval numbers, and a rehearsed five minute demo from a recorded event.
Done when: the demo runs end to end on the deployed app.

## V2 (not in MVP)
Moved out of the MVP on 28 Sep 2026: the X API has no free tier (SPEC.md principle 9).

### [ ] T15 X level 1
search_x_posts on the official recent search endpoint. Results enter research as Tier 3 signals.
Done when: a test proves an X post can appear only as a signal, never as the source of a fact claim.

### [ ] T17 X level 2
Filtered stream over curated accounts and universe keywords, unconfirmed events, confirmation through clustering or research, no push for unconfirmed events.
Done when: an X post creates an unconfirmed card that turns confirmed after a matching Benzinga item arrives.
