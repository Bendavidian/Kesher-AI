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
→ Extract companies, per entity impact, event type, themes, importance 1 to 5  [LLM, structured]
→ Propagate on the interest graph, max 2 hops, weights per edge type           [code, $graphLookup]
→ Relevance, confidence and "Why you" from the exact path                      [code]
→ Research gate: relevance ≥ 0.6, importance ≥ 4, not recent, budget left      [code policy]
→ Research agent with scoped MCP tools and a step budget                       [agent]
→ Claim verification: deterministic checks, then a verifier agent              [code + agent]
→ Card pushed live; research attaches to the same card later                   [Socket.IO]
```
A card is written and pushed as soon as relevance is computed; it never waits for research. Investigate is a second entry point into the same research path. It skips the relevance and importance conditions of the gate but not the budget.

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
- Edge types: holds (per user, from holdings), competitor_of (Finnhub peers), in_sector (company profiles), supplier_of and customer_of (LLM extraction from 10-K sections, reviewed by hand), has_theme (fixed taxonomy).
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
- Input: the event, the user's path and holdings, a step budget (auto mode 6 tool calls, deep mode 15).
- Tools: read only, scoped by the run token.
- Output: typed claims plus open questions, as JSON validated with zod.
- Stops when the budget is spent or every report section has supported claims.

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
Computed from SIP bars older than 15 minutes, the limit of the free Alpaca plan. Fixed windows: 15 minutes, 2 hours, 1 day. Always shown with SMH and SPY in the same window and labeled as delayed. Example wording: "NVDA moved −2.1% in the two hours after the headline; SMH −1.6%, SPY −0.4%." Never "caused".

## X integration (V2)
Moved to V2 on 28 Sep 2026: the X API has no free tier, which breaks principle 9. The design below is kept for V2.
- Level 1: search_x_posts on the official recent search endpoint. Results enter research as Tier 3 signals.
- Level 2: filtered stream over curated accounts plus universe keywords. Tier 3 posts create unconfirmed events, confirmed when clustering links a Tier 1 or Tier 2 item or when research finds corroboration. No push notifications for unconfirmed events.
- Cost control: no cashtag rules on large caps, a spending limit in the X developer console, post ids stored with links back to X.

## Replay and recording
Live items are recorded from day 2: news, filings and price bars (X posts in V2). The demo and the evals replay recorded events through the same pipeline. Historical Alpaca news, available since 2015, can also be replayed.

## Evals
- 20 recorded events × 3 personas, labeled high, medium or none: 60 labels.
- About 10 planted errors for the verifier, and 5 poisoned press releases or posts for injection tests.
- Metrics: label agreement, verifier catch rate, injection success rate before and after defenses, cost and latency per event.

## Domain model
Outline only. T02 turns it into types, zod schemas, collections and indexes.
- User: email, password hash, display name, holdings (embedded: symbol, quantity), interests (themes).
- Company: symbol, name, CIK, filer type (10-K or 20-F), sector, themes.
- Relationship: from, to, type, weight, evidence (source id, quote, filing date, URL, reviewed).
- Source: provider, kind (news, filing, x_post, market_data), tier, external id, URL, author, published at.
- MarketEvent: source ids (cluster), headline, companies with per entity impact, event type, themes, importance, status (unconfirmed or confirmed), embedding.
- FeedItem: user, event, relevance, path, confidence, status, research state. Unique per user and event.
- AgentRun: user, event, agent, mode, trigger, gate decision, steps (tool, input, output summary, latency, tokens), cost, status.
- Report: run, sections with claim ids, open questions.
- Claim: report, type, text, sources with quotes, premises, status, check results.
- FilingChunk: source, symbol, form, section, text, embedding.

The Atlas free tier allows 3 search indexes: event vectors, filing chunk vectors, and one text index for hybrid search.

## Stack
- Frontend: React, TypeScript, Vite, Tailwind, mobile first and responsive.
- Backend: Node and Express with TypeScript, Socket.IO, an in process job queue.
- Data store: MongoDB Atlas free tier with Vector Search and $graphLookup.
- AI: Vercel AI SDK for model calls, so a provider switch is a config change. Groq free tier is primary for extraction, research and verification. Gemini Flash-Lite on the Google AI Studio free tier is the backup for extraction. Official MCP TypeScript SDK.
- Data sources: Alpaca (news stream, news history, SIP bars), Finnhub (peers, profiles), SEC EDGAR (filings, XBRL), all on free tiers. X API in V2.

## Build order
Walking skeleton T01 to T09 by the end of day 3 (docs/BACKLOG.md). Days 4 to 8 deepen each stage, days 9 and 10 cover evals and personas, then deployment, rehearsal and buffer.

## Out of scope (V2)
Thesis guardian, BullMQ and Redis, full PWA, fund look through exposure, Israeli market data, MCP Apps, price anomaly detection, filing RAG for foreign issuers, X level 1 and level 2, a paid Anthropic API key as the LLM upgrade path.

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
