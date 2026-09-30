# State

Updated: 1 Oct 2026, T24 guest portfolios in review (PR open), in parallel with T23

## Where we are
T24, "Your portfolio" on the public instance, is built on its own branch and waits for review; T23, the event library, runs in parallel in another session, and whichever merges second merges origin/main and keeps both (SPEC.md decision log, T24):
- POST /guest makes a temporary guest User from 1 to 6 universe companies and scores every stored extracted event for it with loadScoringContext and scoreFor, no model call (scoreUser in apps/api/src/relevance/feed.ts); a backfilled item takes its event's createdAt. PUT /guest/portfolio rescores in place; a persona gets 403. Login refuses a guest.
- Expiry: User, FeedItem, AgentRun, Report and Claim have an optional expiresAt, set only for a guest and its documents, and TTL indexes (expires_at_ttl) remove them 24 hours after creation. The guest's cookie ends at expiresAt. scoreEvent and isScored count only personas and live guests (liveFilter). The api creates the TTL indexes at startup (ensureIndexes); on Atlas they were created by the development api on 1 Oct 2026.
- Limits (apps/api/src/guest, routes/guest.ts): 5 guests an hour per client address (IPv6 by /64, trust proxy 1 in production), 20 changes an hour per guest and one at a time, 200 live guests. The gate skips a guest's card with condition guest. A guest's Investigate takes one run per UTC day (User.investigatedOn) from a guests' share of the budget: at most 10 guest runs a day, and only while fewer than 20 runs are reserved, so the last 10 stay for the personas' Investigate (research_budget.guestRuns). A demo reset deletes only the personas' items, and a guest gets 403 on POST /demo/replay.
- Web: the switcher's fourth option, Your portfolio, opens a picker by sector (GuestPicker); a reload keeps the guest through GET /me; the last pick prefills the picker from local storage; Replay is hidden for a guest.
- Proof in the browser against Atlas at 1440px and 1279px: a guest holding NVDA and TSM got 26 cards in 3.1 s, then KO alone got 2, and a reload kept it. The reviewer found no blockers; its four majors were fixed (the guests' share and the automatic runs, demo resets of guest cards, concurrent changes, IPv6 keys). 1,066 tests green, 6 skipped.

T00 to T14, T20 and T21 are done; T16 part 1 is done and T16 stays [~] until part 2. T20, the deterministic report core, has merged main after T16 part 1, so point 5 of the MVP definition of done now holds in every report the model completes.

T20 made the 10-K fact and the price metric code claims in every report (SPEC.md decision log, T20):
- Before the model's first turn, code reads the price reaction for the path's event company and holding (Market data read) and writes, in a code step Code claims (CODE_CLAIMS_STEP):
  - e1 and e2, a fact per hop: the edge's reviewed evidence quote, citing its filing Source, text from pathFactText ("TSMC supplies NVIDIA, according to NVIDIA's 10-K."). FACT_VERB says "is a customer of" for customer_of, since HOP_VERB's "buys from" is advice language to no_advice. A direct holding gets no fact.
  - m1, a metric from priceMetricFor: the reaction's first window (open gap, or 15 minutes after a headline inside the session) for the subjects, SMH and SPY, with figures, citing the market_data Source ("TSM opened −1.16% below its previous close and NVDA opened −1.07% below its previous close; SMH −1.00%, SPY −0.22%.").
  - Templates in packages/shared/src/reportCore.ts; the api side in apps/api/src/research/core.ts, which loads the evidence with the card's loader (assembleParts).
- Code claims come first, carry origin code (model claims origin model), and go through checkDraft and the verifier like the model's. The filing's text for them is their own evidence quote, so sources_exist and quote_verbatim pass by construction; the T11 review and the verifier are their real checks.
- The brief lists the code claims by key, type and text (never the filing quote); the model's inferences may name e1, e2 and m1 as premises.
- A claim code cannot write is left out with its reason in Report.omitted (path_fact no_evidence, price_metric not_ready or unavailable); the report screen shows one neutral line per omission (docs/UI.md) and the run still succeeds.
- After the report, only symbols a model metric names beyond the first read are read again; their rows join the first read, and if that read fails, metrics naming them stay unverified. One market_data Source for every metric.
- A draft premise is any string up to 64 characters: a real run put source ids in premises and the schema threw the whole report away, code claims included. checkDraft ignores a fact's premises, removes an inference with an unknown premise and drops one with none known; the premises_supported step records unknownPremise counts. The brief says premises name claim keys, never source ids.
- `npm run seed` backfills Claim.origin (model) and Report.omitted ([]) through backfillReportCore. On Atlas it set 83 claims and 22 reports, then 6 claims and 2 reports more that a session on older code wrote during the proof.
- ResearchRecording.ids.path records the path's edge and filing ids; research:dev merges every reaction read into the recording.
- Proof on Atlas, persona A, TSMC card: three real Investigate runs in a row, each with the 10-K fact and the metric supported (the first series had failed on run 3 with source ids in premises, which led to the premise change). A fourth run through `npm run research:dev -- --record --force` is recorded (7 of 7 claims supported) and replayed in replay.integration.test.ts with the edge, the 10-K and a filing chunk under the recorded ids. Report and run screens checked at 1440px and 1279px.
- The reviewer found one blocker (customer_of rendered as "buys from") and two majors (a second market read that could discard or contradict the first), all fixed, and nothing more on the premise and recording changes.
- 940 tests green, 1 skipped, on T20 alone; 1,003 green, 1 skipped after merging main with T16 part 1.

T16 part 1 measures the pipeline (docs/EVALS.md; SPEC.md decision log, T16):
- Eval set in data/evals:
  - 30 real Alpaca items recorded once in recordings/alpaca, with screen and extraction answers in recordings/models.
  - 90 relevance labels reviewed by the user with `npm run eval:label`, which never shows the proposed label.
  - 5 synthetic poisoned copies of real items under reserved ids 9000000001 to 9000000005, their answers in recordings/synthetic/models.
  - 11 retrieval queries judged by the user with `npm run eval:label -- --retrieval`.
- `npm run eval` (apps/api/src/eval):
  - Replays everything through processItem in a fresh kesher_eval database on a local mongod, seeded with the personas and the 28 reviewed relationships, from recordings, with no provider call, and writes the block between the markers in docs/EVALS.md.
  - `--record` records what is missing, once. Retrieval reads Atlas filing_chunks, read only, and is skipped without MONGODB_URI or the cached model.
  - eval.integration.test.ts runs the same replay in CI.
- Recorders:
  - Model recordings keep latency, without the limiter's waits.
  - A non-429 refusal is recorded as extraction.failure and the replay fails the item the same way. The first recording of 9000000004 was such a refusal; the second, kept, was a suppression.
  - All recorders write Prettier formatted JSON.
- Results, under the decided bands:
  - Relevance agrees on 78 of 90 (A 97%, B 63%, C 100%). Every disagreement is a supply hop at 0.8.
  - Injection changed the extraction in 2 of 5 attacks (1 of 5 with the screen), and only one moved relevance. The screen flagged 2 of 5 poisoned items and 0 of 30 real ones.
  - Tagged-only start nodes give the same relevance on all 30 clean items.
  - Retrieval: precision at 3 is 70%, recall at 3 is 46%.
  - A median extraction is 812 tokens.
- Decided on 30 Sep 2026, and applied in packages/shared (RELEVANCE_HIGH is 1):
  - The display bands are structural: high only for a direct holding, medium for any other relevance above 0, none at 0.
  - The feed filter (above 0), the gate (0.6) and the feed order (newest first) are unchanged.
  - The demo card for persona A now reads Medium 0.80. The design mockups still show High 0.80, a known deviation.
- Start nodes stay extracted and tagged, with no switch to tagged only yet. Part 2 first measures the cost of tagged only on 3 to 5 items with passing mentions.
- The reviewer ran before every api, shared and merge commit. Its blocker, recordings failing the Prettier check, was fixed.
- 968 tests are green after merging main.

Earlier: T09 completed the walking skeleton. T13 part 2, the rest of the MCP tool set, is done and merged with main after T10 and T14. T14, full verification, is merged with main after T10 and T11. T10, live ingestion, is merged with main after T11 and T12. It is proven end to end on Atlas by a live EDGAR 8-K and for the Alpaca stream by fake WebSocket tests; a live Benzinga item is to be observed in the T18 rehearsal.

T13 part 2 completed the MCP tool set (SPEC.md decision log, T13 part 2):
- Tool sets: AGENT_TOOLS in packages/shared. research has all seven MVP tools (get_my_portfolio, get_event, search_news, search_filings, get_company_relationships, get_price_reaction, get_financial_facts); verifier has none by design. mintRunToken and verifyRunToken refuse a tool outside the agent's set, so the verifier never gets a token.
- New tools in packages/mcp (registry.ts lists what the server implements):
  - get_my_portfolio: the token user's holdings as `{ symbol, quantity }`, no argument at all. Holdings store no prices, so INTERFACES now says quantities, not weights.
  - get_company_relationships: reviewed edges from the symbol with their verbatim filing quote, ordered by type then counterpart. Edges are read from the symbol's side (who supplies NVDA is NVDA customer_of); an empty filtered answer names the types the company has.
  - search_filings: $vectorSearch on filing_chunks_vector limited to one 10-K filer, at most 3 passages with their filing Source; 20-F filers get a tool error.
  - get_financial_facts: SEC companyconcept values for a short list of metrics mapped to us-gaap concepts, the 3 newest years and 4 newest quarters by XBRL frame, each citing the filing Source of its accession, which the agent's code stores when missing (upsertFilingSource, apps/api/src/sources/filings.ts). Cached in process for 12 hours; `npm run record:xbrl` commits the answers (recordings/sec-xbrl/NVDA), and tests never call SEC.
  - search_news is hybrid: a word list from the new Atlas Search index sources_text (the third and last search index) and a meaning list from the nearest event vectors, fused by code with reciprocal rank fusion on ranks only. Either list may fail alone. matchedTerms is 0 for an item found by meaning alone.
- The searches sit behind a SearchBackend in the MCP deps: Atlas in apps/api/src/search/atlas.ts, an in memory stand in (test/search.ts) for tests, since plain mongod has no search stages.
- Every tool output stays within 8 KB (fitItems drops whole items and reports omitted; the server turns an oversized output into a tool error).
- Event embeddings: the local MiniLM moved to apps/api/src/embed. processItem embeds each event from its headline and body after extraction and fails open; replay and live ingestion both pass the api's one lazy embedder, which starts loading at startup. `npm run embed:events` backfills (2 events on Atlas).
- Filing quotes: a filing Source keeps text null, so the agent gives it the search_filings passages and evidence quotes returned for it in the run as its text (withPassages, joined with a marker). quote_verbatim and T14's verifier both read that text.
- secFetcher moved to apps/api/src/sec/fetch.ts for the api and the graph job, with SecHttpError carrying the status.
- Research budgets rose to 32,000 tokens deep and 16,000 auto: the first real deep run stopped after two tool turns at 20,000. Gemini's free tier limits requests, not daily tokens.
- Merge with T14: one market_data Source writer, T14's upsertMarketSource. T13 had built its own (a Source per symbols and anchor named by get_price_reaction, with text a metric could quote); it covered nothing numbers_match misses and was removed, with the sourceId and text it added to get_price_reaction. The prompt keeps T13's steps and filing quote rule and T14's metric figures.
- On Atlas:
  - The M0 limit of 3 search indexes was held by a `default` index in the Atlas sample data; with the user's approval sample_mflix was dropped (141.9 MB, nothing else touched), and seed created sources_text, now READY.
  - Seven real research runs on the TSMC card for persona A (before the merge with T14). Run 2 kept a fact quoting the NVIDIA 10-K ("We utilize foundries, such as Taiwan Semiconductor Manufacturing Company Limited, or TSMC, …") with quote_verbatim passed; runs 3 to 6 kept a price metric next to SMH and SPY; run 4 used six tools, 29k of 32k tokens, with every claim passing. No single report had both, because flash-lite picks different claims each run; T20 makes both code claims in every report. The report screen showed the filing and market data sources at 1440px and 1279px.
- The reviewer ran on every api, mcp and shared commit and on the merge; no blockers, its points fixed or noted.
- 902 tests green, 1 skipped (the real bars test without the local cache).

T14 completed verification (SPEC.md Claims and verification, decision log T14):
- Deterministic checks in code, in this order (apps/api/src/research/checks.ts):
  - sources_exist and quote_verbatim as in T08.
  - numbers_match: a metric lists its price moves as figures `{ symbol, window, pct }` (MetricFigure in shared, at most 12). Code reads the price reaction itself at the event's publishedAt through the api's createPriceReactions, never at a time the model chose, and each figure must equal it to 2 decimals. A percentage in the text matches a figure when the figure, rounded half away from zero to the decimals the text shows, equals it; an unsigned number is positive. A metric without figures (a financial fact) or without readable market data stays unverified.
  - no_advice: a fixed word list (buy, sell, hold and forms, analyst ratings; holders, holdings and sell-off pass). A claim with one is removed, an open question with one is dropped and listed in the step.
  - premises_supported, which now also removes inferences in a premise cycle or built on one.
- The verifier (verifier.ts): one generateSingle call per batch on Groq openai/gpt-oss-120b, Gemini per call on a 429, no tools and no run token. Code passes each claim with the text of its cited sources (whole, or passages around its quotes), a metric's moves as code computed them next to SMH and SPY, and an inference's premises, all as quoted data with every angle bracket escaped. It never sees the research agent's messages.
  - It answers supported or unsupported, a reason, and priceCause: whether the claim ties the event to a price move as a cause, hedged or not. Code applies it (applyVerdicts): supported sets supported, unsupported removes, and a claim flagged priceCause is removed unless it is a supported fact (principle 7; the rubric alone let a hedged inference through). No verdict (a failed call, the cap reached) leaves the claim unverified; a failed call never fails the run.
  - Its own cap, 6,000 tokens per run and at most 4,000 per call (AgentRun.verification `{ tokenCap, tokensUsed }`); tokensUsed counts the research agent only. An inference is supported only when the verifier supports it and every premise is supported; premises_supported runs again after the verifier.
- Run steps: Market data read, the check steps with removedClaimIds, a model step named Verifier (VERIFIER_STEP in shared) per call or Verifier failed, the verifier check, Claims not verified when the cap left some out.
- The research token lists get_price_reaction too. A metric cites a market_data Source that code writes, one per event and set of symbols, with no bars and no text; the report names it "SIP bars for NVDA, TSM, SMH and SPY", delayed 15 minutes. Gemini rejects the request when the draft's nested figures array has maxItems, so the draft has none and figures is required, like premises.
- Planted errors: apps/api/src/research/planted.ts, 20 claims over the demo item and its committed reaction, 17 planted errors (one per deterministic check and six for the verifier, among them a hedged causal inference) and an advice question. `npm run verify:dev -- --record` ran the real verifier: 17 of 17 caught, every clean claim supported, twice in a row before recording. planted.test.ts replays recordings/verifier/planted.json.
- research:dev reads market data like the api and records the verifier's answers and the reaction it checked. The demo recording was made again: a fact and a metric supported, and a hedged causal inference removed by the price cause rule.
- Web: the report lists supported claims only; the rest get a neutral line ("N claims were not verified, so they are not shown") and a gray segment, never red. Removal reasons for no_advice and the verifier, a metric's evidence line states its anchor from the card's price reaction, and the removed block links to the check that removed the first removed claim. The run screen shows verifier tokens against their cap and both budgets in the footer; a skipped run reads "Skipped by the research gate" with its reason, and /runs opens the newest run that was not skipped.
- `npm run seed` backfills AgentRun.verification null and metric figures []; it set 11 runs on Atlas. Any other database needs it once, or run reads fail on the strict schema.
- On Atlas, persona A through research:dev: 8 claims supported (2 facts, 6 metrics matching exactly), verifier 1.9k of 6k tokens; the report and run screens checked at 1440px and 1279px, with a skipped run from T12.
- The reviewer found no blockers. Its major point, nested tags rebuilding a prompt tag, was fixed by escaping; its nits were applied or noted.
- Merged main after T10 and T11; 832 tests green, 5 skipped (the local bar cache and T11's embedding model).

T10 adds live ingestion and recording (apps/api/src/ingest):
- Runs in the api process only where LIVE_INGEST is true. With it on, the api does not start without the Alpaca keys and SEC_USER_AGENT (parseLiveEnv in config/env.ts).
- Alpaca news stream (alpacaStream.ts): Node's global WebSocket, auth, subscribe to all news, so the pre filter counts what it drops.
  - It reconnects with a doubling wait from 5 s to 5 minutes, also on 406 connection limit, which it logs every time as a hint that another machine may be live.
  - It stops for good on 402 (keys) or 409 (plan).
  - Items published while it is down are lost (T19).
- EDGAR poller (edgar.ts, edgarPoller.ts): every 5 minutes, the submissions of the 17 universe companies.
  - Forms 8-K, 10-Q, 10-K, 20-F and 6-K, no amendments, accepted in the last 24 hours, 150 ms between requests.
  - A filing becomes a Tier 1 Source with the filer's symbol from its CIK, text null, and a title written by code from the company name, the form and the 8-K item labels. Only well formed item codes pass the schema.
  - A filing seen in this process, or already processed, is skipped before processItem; one stored but not processed is handed over again after a restart.
- live.ts: an item outside the universe goes straight to processItem and is only counted. One that passes is recorded, then queued.
  - The ingest queue (queue.ts) runs one item at a time, merges a waiting item's newer version, and retries a rate limited item up to 3 times after the provider's wait.
  - A scored live item takes the same after scoring hook as replay: createApi (app.ts) returns afterScoring (the pushes, then the research gate), and server.ts hands it to the live ingester. The gate only queues research, so the ingest queue never waits for a run.
- Recordings: the recordings collection (LiveRecording in shared) holds the raw item as the provider sent it, without the article body or images, only for items that passed the pre filter; the first version is kept.
  - POST /dev/replay/:sourceId and /dev/reset/:sourceId take an Alpaca news id or an EDGAR accession number; replay reads the committed file first, then the collection.
  - `npm run recording:export -- --id <id>` writes a file for an item picked for the demo or the evals.
  - Live price bars are not recorded; a replay computes the reaction again from Alpaca's history.
- toIncomingItem drops provider symbols that fail Ticker instead of failing the item. AlpacaNewsItem moved to shared.
- On Atlas, with LIVE_INGEST on:
  - The poller's first pass brought a real AMD 8-K (0000002488-26-000182, "Unregistered Sales of Equity Securities") to persona A's feed with no manual action, through AMD supplies MSFT.
  - Reset and replay by accession then answered processed from the recordings collection with no model call, and a second replay answered duplicate.
  - The stream subscribed each time, but no Benzinga item passed the pre filter in the windows it ran (about 35 minutes, then 4, early afternoon Israel time, before the US open).
- In CI, a fake WebSocket delivers a TSMC item under a fresh id: persona A gets feed:item with no HTTP call, and the item is recorded without its body. The item outside the universe is counted live.
  - The gate starts an auto run for the live card.
  - Reset and replay work from the collection alone.
- The reviewer found no blockers in either pass. Its majors were fixed: resume unprocessed filings, validate item codes, retry on 406. The remaining points are in T19.
- 673 tests were green before merging main after T11; see the session log for the count after it.

T11 built the interest graph from SEC filings and the filing chunks for RAG, all under apps/api/src/graph, as offline jobs nothing in the api server imports:
- Decisions (SPEC.md decision log, T11): evidence stays strict, and Finnhub peers are candidates only; in_sector and has_theme stay Company attributes; the seed owns the Company reference fields and the six demo edges, T11 owns every other relationship and the filing chunks; no minimum edge count, every candidate is reviewed and the count reported; TSM and ASML 20-Fs are edge evidence only.
- `npm run graph:candidates` (build-candidates.ts):
  - Reads the latest 10-K or 20-F of each universe filer through the EDGAR submissions API into the gitignored .cache/sec (sec.ts, SEC_USER_AGENT, 150 ms apart). XOM falls back to CIK 0000034088.
  - Cuts Item 1 and 1A (Intel by its cross-reference headings), and Item 4 and 3.D for 20-Fs (ASML by page ranges from its reference table); sections.ts, ported from research/edges.
  - Every sentence that names another universe company is a candidate, keyed like docs/research/edge-candidates.md; one ASML sentence outside those sections (the TSMC supplier award) was added as borderline on request.
  - Groq gpt-oss-120b classifies each (sentence, company) as supplies_filer, buys_from_filer, competitor or none, with no tools and the sentences quoted as untrusted data; code turns the role into an edge. 14 calls, about 24,600 tokens, once; recordings/graph/classify replays by prompt hash.
  - Finnhub peers and profiles are recorded in recordings/finnhub; peers only flag candidates, profiles only print differences with the seed (none, ASML.AS and 2330.TW included).
  - Writes data/graph/candidates.json: 88 sentences, 110 rows with the model's role next to the research decision (data/graph/research-decisions.json, exported from research/edges). classify.replay.test.ts rebuilds it from committed files with no provider call.
- `npm run graph:review` (review-cli.ts): one relationship at a time with every quote, section and URL; the user types the evidence number, r, s or q. Each decision is written at once to data/graph/reviews.json; a redo keeps the earlier decision until a new one replaces it; reviews that no longer match the candidates stop everything. Nothing is accepted by default.
- `npm run graph:apply -- [--dry-run]` (apply.ts): writes each accepted relationship with its inverse and reviewed: true, inserts the filing Sources behind the evidence once, removes only edges of relationships the user rejected, never touches the seeded edges, and prints the distinct count.
- `npm run graph:chunks` (chunks.ts, embed.ts): Item 1 and 1A of the 15 10-K filers in chunks of at most 256 word pieces that never cross a heading, embedded locally as "heading. text" with Xenova/all-MiniLM-L6-v2 (fp32, @huggingface/transformers 4.3.0, model in the gitignored .cache/models), keyed by source and index. Only page numbers, "Table of Contents" and 10-K footers are dropped (0.25% of the text).
- `npm run graph:search -- "<query>" [--symbol X]`: read-only $vectorSearch on filing_chunks_vector.
- On Atlas:
  - The user reviewed all 28 proposed relationships: 22 accepted, 6 rejected. The database holds 28 distinct reviewed relationships (6 seeded, 22 from T11) in 56 edge documents; a second apply changed nothing.
  - 2,010 filing chunks; a second run changed nothing. Limited to NVDA, "foundry dependency" returns NVIDIA's foundry risk passages in the top 3 and "TSMC foundry dependency" the TSMC passage first (the check was reworded with the user; SPEC.md decision log, T11).
  - The demo still scores A 0.8 through TSM supplier_of NVDA, B 1 and C 0.
- The reviewer ran before every api commit; its blockers were fixed: a redo that could lose a decision, and an apply delete that would have removed every unlisted T11 edge.
- embed.test.ts runs only where the model is cached and skips in CI. @huggingface/transformers is a new api dependency: check that npm ci installs it on the Ubuntu and Windows runners.
- 720 tests are green after merging main.

T12 added the research gate and automatic research, so a card goes out as soon as it is scored and research attaches to it later:
- The gate (apps/api/src/research/gate.ts, auto.ts) runs after each scoring run has pushed its cards, for every FeedItem above relevance 0. Code only, in this order:
  - AUTO_RESEARCH on;
  - relevance at least 0.6 and importance at least 4;
  - research on the card not queued or running;
  - no run for this user and event in the last 24 hours that was not skipped, whatever its trigger. When that run has a report and the card shows none, the report is attached to the card (done) with no model call;
  - the daily budget.
- A run that passes is queued in auto mode (6 tool calls, 12,000 tokens) with trigger gate, and its reason names each condition and its place in the budget.
- Every skip on a card above relevance 0 is stored as an AgentRun with status skipped, the reason, and one Gate check step naming the condition. Relevance 0 stores nothing.
- Daily budget (dailyBudget.ts): research runs per UTC day in the new research_budget collection (ResearchBudgetDay in shared), one document per day that both machines share, reserved with one atomic conditional $inc. 30 a day in total, and automatic runs stop at 20, so at least 10 stay for Investigate. A reserved run stays counted even if it never starts.
- One in process FIFO queue (apps/api/src/jobs/queue.ts) runs one research run at a time, for the gate and for Investigate. enqueueResearch (enqueue.ts) is the one path:
  - it claims the card as queued, reserves the budget or gives the card back its previous state, then moves the card queued → running → done or failed;
  - every change is pushed as feed:update;
  - the 15 minute takeover now covers queued as well as running.
- Investigate answers 202 with the card queued, and 429 with "Today's research budget is spent (30 of 30 runs). It resets at 00:00 UTC." once the day is spent; a 429 changes nothing.
- createApp composes the hook that runs after scoring: first the socket push (a failed push is logged), then autoResearch. Replay and, since T10, live ingestion use it.
- AUTO_RESEARCH env flag: true or false, on when unset, any other value stops the api at startup. Off, the gate stores a skip with condition auto_research_off for every card, calls no model and reserves no budget. Investigate is unchanged.
- The web needed no change: queued shows the same line as running, and the 429 text shows under the button.
- On Atlas, with the browser:
  - First Replay: B got a real auto run on Gemini (5,293 tokens, succeeded) and its report renders ("Auto mode, 2 of 6 tool calls"). A was skipped as recent, since it had an Investigate run from T08 that day, and that report was attached to its card.
  - Second Replay: both were skipped with their reports attached, with no model call, and the budget stayed at 1.
- The reviewer found no blockers. Its points on the push failure, errors while reserving, attaching from an earlier run, and the notes on queue depth and failed runs were fixed or documented.
- 529 tests were green on T12 alone; after the merge with main (T09 and T13 part 1), 627 pass and 1 skips (the real bars test, without the local cache).

T09 made the agent run inspectable from its card:
- api (apps/api/src/research/runs.ts, apps/api/src/routes/research.ts):
  - GET /runs lists the signed in user's runs, newest first, without steps.
  - GET /runs/:runId returns RunDetail `{ run, reportId, claims, eventSymbol, limits }`.
  - Both take the user from the session only; another user's run answers 404.
  - limits are the free tier limits of the models the run's steps used, from MODEL_LIMITS and the new REQUESTS_PER_DAY in llm/limits.ts. A test keeps the two tables on the same models.
- Socket.IO:
  - runResearch has onStep and onEnd hooks. realtime pushes run:step `{ runId, index, step }` for each stored step and run:end `{ runId, status }`, to the run's user room only.
  - A failed push is logged and never stops the run.
  - The index relies on record() staying sequential; a client that sees a gap reads the run again.
- packages/shared: ToolName moved here from packages/mcp, which re-exports it. New RunDetail, RunSummary, FreeTierLimit, RunStepPushed and RunEnded.
- Web:
  - The run screen reads the api, then adds pushed steps and reads the run again on run:end. A run id that answers 404 (the window before runResearch stores it) loads on its first run:step.
  - Step output renders as JSON or as plain text, never as markup; a cut output says "capped at 8 KB".
  - The access block reads the run's own Run token issued step. A check is red when its output lists removedClaimIds.
  - The Agent runs tab (/runs) opens the newest run, or says there is none.
  - A Recent runs selector in the header lists the user's runs with time in ET, mode and status, and switches between them (docs/UI.md).
  - View agent run on the card links to research.runId from the start of a run.
  - DEMO_STEP_OUTPUTS, DEMO_TOKEN_SCOPE and the web's FREE_TIER copy are gone; the demo fixtures now store step output as JSON text, like the api.
- On Atlas, persona A, Investigate again and then View agent run: the timeline grew 3, 5, 7, 10 steps while the run went, then turned Completed after 4.9 s, 5.3k of 20k tokens on gemini-3.5-flash-lite. Screens were checked at 1440px and 1279px; the selector listed 7 real runs. Atlas has no failed run yet, so failed next to succeeded is shown in tests only.
- The reviewer found no blockers; two nits were fixed (the sequential record() comment, the limit table test).
- 526 tests are green.

T13 part 1 computes the price reaction in code and shows it on the card:
- packages/shared/src/price.ts, pure and browser safe:
  - resolveAnchor anchors a headline to the regular session from the market calendar. Inside [open, close) the base is the headline; otherwise the previous close, with the windows in the next session (weekends, holidays, after an early close, premarket).
  - computeReaction follows the spike. The base is the close of the bar at the headline or the previous session's last bar. open_gap uses the first open; 15m, 2h and session_close use the last bar at or before their end, capped at the close.
  - A bar counts once it closed 15 minutes ago, and the base only once it is final; a window not ready is null. complete says the result can no longer change.
  - priceReactionFor(market, subjects, headline, now) reads through a MarketData interface and always appends SMH, then SPY.
  - FeedCard.priceReaction is PriceReaction.nullable().
- apps/api/src/market:
  - alpaca.ts: the calendar (paper-api) and SIP 1Min bars, zod validated, with a 10 second timeout per request.
  - data.ts: createMarketData reads local files first and asks Alpaca only for what they lack. Alpaca keys are optional (loadAlpacaKeys), so the api starts without them and only uncached data fails.
    - recordings/alpaca-calendar/<year>.json is committed; only 2024 so far.
    - recordings/alpaca-bars/<SYMBOL>/<date>.json is a gitignored local cache (Alpaca's data terms; the repo becomes public).
  - reactions.ts: createPriceReactions keeps complete results in process (at most 1,000).
  - `npm run record:bars -- --event 38062166 --symbols TSM,NVDA` fills the cache for the demo and writes the computed reaction to recordings/price-reactions/38062166.json, the committed fixture.
- get_price_reaction in packages/mcp:
  - Its input is a universe company and an ISO time with an offset, and its output is ISO JSON.
  - Only PriceReactionError reasons reach the agent. A provider error becomes "Market data is unavailable" and is logged, redacted, by /mcp.
  - The research token still lists get_event and search_news only.
- Cards:
  - One createPriceReactions instance in server.ts serves /mcp, GET /feed, the scoring pushes, publishItem, the Investigate 202 card and the report's card. T09's run routes, run:step and run:end carry no card, so no push clears the market table.
  - A card asks for the path's event company and holding, waits at most 5 seconds (CARD_REACTION_TIMEOUT_MS), and carries null on failure; the feed never breaks.
  - The redactor masks the Alpaca keys.
- Web:
  - priceReactionView maps the api's reaction into the market table, the open gap bars and the ticker footer.
  - A window not ready shows a dash with "not available yet" for screen readers, and the open gap sentence waits for every benchmark. Without a reaction the empty state stays.
- Dev servers read WEB_PORT, API_PORT and PORT; .claude/launch.json has api-alt on 3011 and web-alt on 5183 for a parallel session.
- Proof:
  - The demo event from real bars reproduces SPIKE.md check 3 exactly (TSM −1.16, −0.38, +1.31, +1.25; NVDA, SMH and SPY too). The local test that checks this skips with a message when the cache is missing.
  - Tests cover a weekend, Good Friday and the 13:00 close on 29 Nov 2024 on the committed calendar.
  - On Atlas through 5183, persona A's card showed that table next to NVDA (you hold), and persona B's showed TSM, SMH and SPY, at 1440px and 1279px.
- The reviewer ran on every api, mcp and shared commit. It found no blockers; its points (a base that was not final, Alpaca stalls, cards without the market after the rebase) were fixed.
- 595 tests are green after the merge with T09 (the real bars test included; it skips where the cache is missing).

T08 part 2 wired Investigate to the research agent from part 1, now that T06 gives every route a signed in user:
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
0. Review and merge the T24 PR after CI passes on Ubuntu and Windows. If T23 merged first, merge origin/main into the T24 branch and keep both sides (T23 changes the feed order and adds GET /feed/hidden in apps/web and the feed routes). After the deploy, check on Render that guests from two networks get separate rate limit windows (trust proxy 1).
1. Check that CI passes on Ubuntu and Windows for PR 23 "T20: deterministic report core", then merge it. Keep LIVE_INGEST false on both machines until T18 or T19.
2. Any database a session on older code writes to needs `npm run seed` again after this merge, or its claims and reports fail the strict schema (origin, omitted). Atlas is repaired as of 30 Sep 2026.
3. On each machine, once:
   - `npm run record:bars -- --event 38062166 --symbols TSM,NVDA` fills the gitignored bar cache for the demo card and the local SPIKE.md test.
   - The api loads the local embedding model at startup (about 90 MB into .cache/models, downloaded once); `npm run embed:events` embeds events stored before. `npm run eval` needs the same cache for its retrieval part.
4. Pick the next task from BACKLOG.md:
   - T22, a database per session: in T20 a parallel session's reset of the demo event on the shared Atlas database removed persona A's card mid-proof and wrote documents in the old schema.
   - T16 part 2 (notes under T16):
     - the verifier catch rate on the T14 planted fixture;
     - claims reported by origin, and how often the model restates the code metric (notes from T20);
     - retrieval on the hybrid search;
     - injection on research;
     - the research budgets (32,000 and 16,000), the gate and FLAG_THRESHOLD;
     - the materiality flag per reviewed edge, set in graph:review (the likely case is AMD supplier_of MSFT);
     - 3 to 5 items with passing mentions to measure tagged-only start nodes;
     - the feed order (recency, or band then relevance), a GET /feed contract change;
     - the README numbers.
   - T19, live ingestion hardening, before LIVE_INGEST runs all day.
5. On the Windows laptop:
   - Pull and run npm install. Check that Node is at least 22.12 (.nvmrc says 26).
   - Start both servers from .claude/launch.json; it may need npm.cmd instead of npm.
   - The first npm run test downloads mongod 8.0.32, about 100 MB. The eval integration test starts mongod twice more.
   - That machine's .env needs GROQ_API_KEY and GOOGLE_GENERATIVE_AI_API_KEY for replay, Investigate and research:dev, and MCP_TOKEN_SECRET and JWT_SECRET of at least 32 characters each, or the api does not start. It needs SEC_USER_AGENT for get_financial_facts.
   - Check that git keeps the committed JSON with LF line endings, so the Prettier check in npm run lint passes there too.
   - Run `npm run seed` once if that machine uses its own database, so older documents are backfilled; its search indexes need Atlas.
   - Both machines share one daily research budget on Atlas (30 runs, automatic runs stop at 20). Set AUTO_RESEARCH=false in a machine's .env if it should not start automatic runs.
   - Keep LIVE_INGEST=false there: the free Alpaca plan allows one live WebSocket.

Keys set in .env: SEC_USER_AGENT, ALPACA_API_KEY_ID, ALPACA_API_SECRET_KEY, FINNHUB_API_KEY, MONGODB_URI, JWT_SECRET, MCP_TOKEN_SECRET, GROQ_API_KEY, GOOGLE_GENERATIVE_AI_API_KEY. LIVE_INGEST is false on both machines except while proving T10; with it true the api also needs the Alpaca keys and SEC_USER_AGENT. AUTO_RESEARCH is optional (on when unset).

## Open decisions
From T16 part 1, each needing its own decision log entry: keep the edge weights; no theme overlap in relevance; the feed order; a materiality flag per edge; tagged-only start nodes. FLAG_THRESHOLD stays 0.5 for now.
None for T11: its three open decisions were settled on 29 Sep 2026 (SPEC.md decision log, T11).
The UI language is settled by docs/UI.md: English interface, with Hebrew summaries as a later option.

## Session log
Newest first. One line per session: date, machine, task, result.
- 1 Oct 2026, macOS (Mac mini), T24: guest portfolios on the public instance; POST /guest with a backfill scored by code and no model call, PUT /guest/portfolio in place, TTL expiry of the guest's user, items, runs, reports and claims, per address rate limit and a live guest cap, the gate's guest condition, one guest Investigate a UTC day within a guests' share of the budget, demo resets that leave guest cards; Your portfolio in the switcher with a picker by sector; reviewer's four majors fixed; checked in the browser against Atlas; 1,066 tests green, 6 skipped; PR open, T24 [x] pending merge.
- 30 Sep 2026, macOS (Mac mini), T20: code writes the path's 10-K fact (e1, e2) and the price metric (m1) in every report from shared templates, before the model's first turn, listed in the brief; Claim.origin and Report.omitted with a seed backfill and a neutral report line per omission; FACT_VERB so customer_of passes no_advice; one reaction read for the path, missing symbols merged or left unverified; draft premises relaxed after a real run lost its report to source ids in premises, with unknownPremise counts in the run; three real Investigate runs in a row with both code claims supported, a fourth recorded and replayed; Atlas repaired after a parallel session's reset; T22 added and a T16 note; reviewer's blocker and majors fixed; merged main after T16 part 1; 1,003 tests green, 1 skipped; T20 done.
- 30 Sep 2026, macOS (Mac mini), T16 part 1: T16 split in two; eval set of 30 recorded Alpaca items with 90 labels reviewed by the user (labeling CLI that hides the proposal; two rushed labelings reset), 5 synthetic poisoned items and 11 judged retrieval queries; npm run eval replays everything in a fresh kesher_eval on a local mongod from recordings and writes docs/EVALS.md, CI runs the same; recorders keep latency, record refusals and write formatted JSON; results under the decided bands: relevance 78 of 90, injection 2 of 5 (1 of 5 with the screen), screen 2 of 5 flagged and 0 false flags, tagged-only start nodes equal on clean items, retrieval precision at 3 70% and recall 46%; display bands decided and applied (high only for a direct holding, medium above 0); part 2 notes on materiality, passing mentions and feed order; T21 marked done from PR 19; reviewer ran on every api, shared and merge commit; merged main after T13 part 2, T14 and T21; 968 tests green; PR 21 open; T16 stays [~].
- 29 Sep 2026, macOS (Mac mini), T13 part 2: agent tool sets with the verifier empty; get_my_portfolio, get_company_relationships, search_filings, get_financial_facts from recorded SEC XBRL, hybrid search_news with the sources_text index and rank fusion; event embeddings at extraction with a backfill; 8 KB tool output cap; filing quotes checked against the text tools returned; budgets 32,000 and 16,000; sample_mflix dropped on Atlas to free the third search index; seven real runs proved the 10-K fact and the price metric in separate reports (T20 makes them code claims); merged main after T10 and T14 with T14's market_data writer kept; T20 and T21 added; 902 tests green, 1 skipped; T13 done.
- 29 Sep 2026, macOS (Mac mini), T14: deterministic checks sources_exist, quote_verbatim, numbers_match against the price reaction code reads at the event time (with the rounding rule for text), no_advice and premises_supported with cycles; a tool-less verifier on Groq with its own 6,000 token cap that sees claims and sources only, and a priceCause classification that code uses to remove any claim tying the event to a price move as a cause (principle 7, inferences included); research token adds get_price_reaction, metrics carry figures and cite a market_data Source; planted fixture caught 17 of 17 with the real verifier; report shows supported claims only, skipped runs labeled, /runs opens the newest run not skipped; seed backfill; reviewer found no blockers, its major point fixed; merged main after T10 and T11; 832 tests green, 5 skipped; T14 done.
- 29 Sep 2026, macOS (Mac mini), T10: Alpaca news stream and EDGAR poller behind LIVE_INGEST, an ingest queue one item at a time with 429 retries, live recordings in a recordings collection without article bodies, replay and reset by Alpaca id or accession from file or collection, recording:export, live items through the same after scoring hook as replay (merged main after T12); on Atlas a real AMD 8-K reached persona A's feed and replayed from the collection, no Benzinga item passed the pre filter while live was on; reviewer found no blockers; T19 added; merged main after T11, 762 tests green, 4 skipped; T10 done (a live Benzinga item goes to the T18 rehearsal).
- 29 Sep 2026, macOS (Mac mini), T11: graph build job under apps/api/src/graph: 10-K and 20-F sections from EDGAR, candidate sentences classified by Groq into roles that code turns into edges, recorded and replayed, Finnhub peers and profiles recorded, a review CLI, an apply that writes accepted edges with inverses and removes only rejected ones; the user reviewed all 28 proposed relationships, so Atlas holds 28 distinct reviewed relationships (6 seeded, 22 from T11); 2,010 heading-aware filing chunks embedded locally, the NVDA foundry checks pass; demo scores unchanged; reviewer blockers fixed; merged main after T09, T12 and T13 part 1; 720 tests green; T11 done.
- 29 Sep 2026, macOS (Mac mini), T12: research gate after scoring (relevance 0.6, importance 4, active, recent run in 24 hours with the report attached), skipped runs stored with their reason, daily budget of 30 runs with 20 for automatic runs in research_budget, one FIFO research queue for the gate and Investigate (202 queued, 429 once spent), AUTO_RESEARCH flag on by default; on Atlas B got a real auto run and a second Replay attached both reports with no model call; reviewer found no blockers; merged main with T09 and T13 part 1; 627 tests green, 1 skipped; T12 done.
- 29 Sep 2026, macOS (Mac mini), T13 part 1: T13 split in two under one id; price reaction in shared anchored to the regular session through the market calendar, get_price_reaction over MCP and FeedCard.priceReaction from the same function, Alpaca calendar and SIP bars behind a file-first market data layer with a gitignored bar cache and npm run record:bars, the web market table and open gap bars on live values; the demo reproduces SPIKE.md check 3 exactly; WEB_PORT and API_PORT with api-alt and web-alt; rebased on T08 part 2; merged main after T09; reviewer found no blockers; 595 tests green; T13 stays [~].
- 29 Sep 2026, macOS (Mac mini), T09: GET /runs and GET /runs/:runId for the signed in user only, run:step and run:end to the run's user only, run screen on the api with live steps, text only step output, token scope from the run's own step, Recent runs selector and /runs opening the newest run; a real Investigate on Atlas streamed 3, 5, 7, 10 steps to Completed; reviewer found no blockers; 526 tests green; T09 done.
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
