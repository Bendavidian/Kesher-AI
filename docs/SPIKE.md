# T00 Spike results

Run on 28 Sep 2026 at 09:35 UTC, on the Mac mini (macOS 26.5.2, Node 26.0.0), with `cd spike && npm run spike`. All seven checks ran in order in a single run. The Alpaca check was run again later that day with `ONLY=alpaca`, after the market calendar was added under decision A, and it passed again. Raw results are in `spike/output/` (gitignored); a scan of those files and of every tracked file found no secret values.

Packages: ai 7.0.118, @ai-sdk/groq 4.0.50, @ai-sdk/google 4.0.82, mongodb 7.6.0, @huggingface/transformers 4.3.0, zod 4.6.5, tsx 4.23.15.

## Summary

| # | Check | Result | Key evidence | Free tier limit observed |
|---|---|---|---|---|
| 1 | SEC EDGAR | pass | NVIDIA 10-K filed 25 Feb 2026, TSMC foundry sentence found verbatim | 10 requests per second, declared User-Agent |
| 2 | Finnhub | pass | NVDA peers and NVDA, TSM profiles | 60 calls per minute |
| 3 | Alpaca | pass | Earthquake item found in the primary window; SIP bars for TSM, NVDA, SMH, SPY; market calendar handles holidays and early closes; live item after 188 s | 200 calls per minute, one WebSocket connection |
| 4 | Groq | pass | gpt-oss-120b extracts TSM, negative, natural_disaster, importance 4 in 1.2 s | 8,000 tokens per minute, 1,000 requests per day |
| 5 | Gemini | pass | gemini-3.5-flash-lite gives the same extraction in 1.5 s | per model daily quota (fill from console) |
| 6 | Embeddings | pass | Both options pass the retrieval test; **local MiniLM recommended** | Gemini: per model quota; local: none |
| 7 | Atlas | pass | 384 dim vector index queryable in 24 s, $vectorSearch ranks correctly, $graphLookup reaches A at hop 2 and B at hop 1, not C | 512 MB, 3 search indexes |

No check failed. The six findings below were decided on 28 Sep 2026 and are recorded in the SPEC.md decision log.

## Console numbers to fill in by hand
The spike cannot read the consoles. Please fill these in:
- Groq, openai/gpt-oss-120b, daily quota (console.groq.com, Settings, Limits): requests per day ____, tokens per day ____.
- Google AI Studio, gemini-3.5-flash-lite, free tier: requests per minute ____, requests per day ____.
- Google AI Studio, gemini-embedding-2, free tier: requests per minute ____, requests per day ____.
- Confirm that billing is off on the Google Cloud project behind GOOGLE_GENERATIVE_AI_API_KEY: ____.

## 1. SEC EDGAR: pass
- Submissions API for CIK 0001045810 answered in about 0.4 s. The latest 10-K is accession 0001045810-26-000021, filed 25 Feb 2026, for the period ending 25 Jan 2026.
- Primary document: https://www.sec.gov/Archives/edgar/data/1045810/000104581026000021/nvda-20260125.htm (1.97 MB of HTML, 340k characters of text, fetched in about 0.5 s).
- The TSMC passage, found verbatim after stripping HTML: "We utilize foundries, such as Taiwan Semiconductor Manufacturing Company Limited, or TSMC, and Samsung Electronics Co., Ltd., or Samsung, to produce our semiconductor wafers."
- Only one sentence in the whole 10-K names TSMC. The supplier edge TSM → NVDA rests on that single quote, which is enough under "no evidence, no edge".

## 2. Finnhub: pass
- NVDA peers: NVDA, AVGO, MU, AMD, INTC, TXN, MRVL, QCOM, ADI, MPWR, ALAB. Six of them are in the demo universe.
- Profiles: NVDA is NVIDIA Corp on NASDAQ, industry Semiconductors. **TSM comes back as 2330.TW** (Taiwan Semiconductor Manufacturing Co Ltd, Taiwan Stock Exchange), not as the NYSE ADR. See finding B.
- Rate limit headers: limit 60 per minute.

## 3. Alpaca: pass
**Demo item (primary window, 2 to 4 Apr 2024, no fallback needed).** The window has 19 TSM items; 6 mention the earthquake, and 2 of those name TSMC in the headline. The check takes the earliest one that names TSMC:
- id 38062166, Benzinga, 2024-04-03T03:57:09Z (23:57 ET on 2 Apr): "TSMC Suspends Chip Production After Taiwan Rocked By Strongest Tremor In 25 Years", symbols TSM.
- The first version of the matcher looked only for "earthquake" and picked a later headline that names no company. With that headline both LLMs correctly returned no companies. The matcher now also accepts "tremor" and prefers headlines that name TSMC.
- Decision: the demo item is now pinned by id (DEMO_SOURCE_ID=38062166), and replay selects items by id, never by keyword. The spike's keyword search only served to find the item.

**SIP bars.** Minute bars from 2 Apr 03:57Z to 4 Apr 09:57Z came back in one page (0.4 s): TSM 1,317 bars, NVDA 1,598, SMH 1,000, SPY 1,608. The free plan serves SIP history without trouble.

**Price reaction (association only, never cause).** The headline arrived at 23:57 ET, after the extended session had closed, so windows measured from the headline are meaningless. At +15 min and +2 h the last bar is the 19:59 ET bar, over four hours old, and both show 0.00%. Windows anchored to the regular session give a usable picture. The base is the previous regular close (2 Apr, 15:59 ET):

| Symbol | Open gap | 15 min after open | 2 h after open | Session close |
|---|---|---|---|---|
| TSM | −1.16% | −0.38% | +1.31% | +1.25% |
| NVDA | −1.07% | −0.90% | +0.86% | −0.54% |
| SMH | −1.00% | −0.68% | +0.96% | +0.40% |
| SPY | −0.22% | −0.07% | +0.40% | +0.10% |

See finding A.

**Market calendar (added under decision A).** `GET paper-api.alpaca.markets/v2/calendar` works with the same keys, in about 0.4 s. `api.alpaca.markets` answers the same way.
- Around the event it lists 27 and 28 Mar and 1 to 10 Apr 2024. Good Friday (29 Mar) and the weekends are missing, as they should be.
- A Thanksgiving 2025 probe returns 26 Nov (09:30 to 16:00), no 27 Nov (the holiday), 28 Nov with the early close at 13:00, then 1 Dec.
- The session-anchored numbers above are computed with this calendar; the base is 2 Apr and the trading day is 3 Apr 2024.

**Live news.** The WebSocket connected in 0.8 s, then authenticated and subscribed. A live Benzinga item (symbols MU, SOXQ, SOXX, XNTK) arrived after 188 s at 05:38 ET. Other runs got one after 126 s and 23 s. See finding D.

## 4. Groq: pass
- Model: openai/gpt-oss-120b, the first available model on the preferred list (strict json_schema support). The account can use 11 models.
- One call with the zod schema; the article is passed as quoted data and the model has no tools. The result: TSM ("Taiwan Semiconductor Manufacturing Co."), impact negative, event type natural_disaster, themes [foundry], importance 4. That matches "production disruptions" in the rubric.
- Latency 1.15 s. Tokens: 557 in and 326 out, of which 275 are reasoning tokens, for 883 in total.
- Rate limit headers: 1,000 requests per day and 8,000 tokens per minute. See finding E.

## 5. Gemini Flash-Lite: pass
- Model: gemini-3.5-flash-lite, the newest stable Flash-Lite. Candidates seen: gemini-2.5-flash-lite, gemini-3.1-flash-lite, gemini-3.1-flash-lite-preview, gemini-3.5-flash-lite, gemini-flash-lite-latest and others.
- Same call, same result: TSM ("TSMC"), negative, natural_disaster, themes [foundry, chip_design], importance 4.
- Latency 1.5 s. Tokens: 176 in, 86 out, 262 total, with no reasoning tokens. The very first call of the session took 16 s, which looks like a cold start; every call after that took about 1 to 1.5 s.
- Gemini returns no rate limit headers, so the quota has to come from AI Studio.

## 6. Embeddings: pass, recommend local MiniLM
The test set has 5 documents: the NVIDIA 10-K sentence from check 1, the demo headline from check 3, and 3 synthetic distractors about KO, XOM and JNJ. It runs 2 queries.

| | Gemini gemini-embedding-2 | Local Xenova/all-MiniLM-L6-v2 |
|---|---|---|
| Dimensions | 3072 | 384 |
| Latency | 0.85 s for a batch of 5, about 0.4 s per single query | 1.8 ms per text |
| Model load | none | 132 ms cached; 38 s one-time download (97 MB cache) |
| "foundry dependency" | foundry passage first, 0.13 ahead of the nearest distractor | foundry passage first, 0.06 ahead of the nearest distractor |
| "semiconductor manufacturing in Taiwan" | both TSMC documents on top, 0.18 margin | both TSMC documents on top, 0.30 margin |
| Needs key, quota, network | yes | no |
| Input limit | long | 256 tokens |

**Recommendation: local all-MiniLM-L6-v2, 384 dimensions, cosine.**
- It costs nothing, needs no key, has no quota and makes no network call when a query runs. That rules out a 429 in the middle of the demo.
- It is about 200 times faster per text.
- Each vector is an eighth of the size, which matters on a 512 MB M0: about 3 KB against 25 KB per stored vector.

What it costs:
- Weaker separation on the first query.
- A 256 token input limit, so filing chunks must stay near 200 tokens (about 800 to 1,000 characters). That also suits quote-level evidence.
- The api process has to load the model for query embeddings. Memory on the free host still has to be checked in T18.

Upgrade path: Gemini gemini-embedding-2 with `outputDimensionality: 768`, if the T16 evals show retrieval misses. At our volume, switching means re-embedding and rebuilding one index. Hybrid search with the text index also covers exact term queries. See finding F.

## 7. MongoDB Atlas: pass
- Server 8.0.32, connected in 1.0 s. All work happened in a separate `kesher_spike` database, which was dropped at the end together with its index, so the 3-index M0 limit is untouched.
- The vector index (384 dimensions, cosine) over the local embeddings became queryable after 24 s.
- `$vectorSearch` took about 0.1 s per query. "foundry dependency" returns foundry, then tsmc_headline, then xom. "semiconductor manufacturing in Taiwan" returns foundry, then tsmc_headline, then xom. Both rankings are as expected.
- Atlas reports cosine scores as (1 + cos) / 2: 0.60 in Atlas means a raw cosine of 0.20. Use vector scores only for ranking, never as a threshold that decides anything (principle 3).
- `$graphLookup` from event company TSM with maxDepth 1 (2 hops) ran in 86 ms. It reached user:B at hop 1 (holds TSM) and user:A at hop 2 (TSM supplier_of NVDA, held by A), and did not reach user:C. That is the three-persona demo in miniature.

## Findings and decisions
All six were decided on 28 Sep 2026. Each decision is in the SPEC.md decision log, and the affected SPEC.md sections, INTERFACES.md and BACKLOG.md tasks are updated.

**A. Price reaction windows break for headlines outside market hours.**
The demo headline lands at 23:57 ET, so fixed windows measured from the headline show 0.00% against a bar four hours old.
Decided:
- Windows are anchored to the regular session. The Alpaca market calendar resolves weekends, holidays and early closes to the correct trading day.
- A headline inside a session uses the price at the headline as the base. Any other headline uses the previous regular close, with an open gap window.
- get_price_reaction returns the anchor it used.
- Updated: SPEC.md Price reaction, INTERFACES.md get_price_reaction, BACKLOG.md T13.

**B. Foreign issuer symbols differ by provider.**
Finnhub profile2 for TSM returns 2330.TW, while Alpaca news and bars use TSM.
Decided: Company keeps `symbol` as the US ticker and adds `primaryListing`. Updated: SPEC.md Domain model, BACKLOG.md T02 and T11 (T11 checks ASML too).

**C. Finnhub peers include companies outside the universe, and edges need both directions.**
NVDA peers include TXN, MRVL, ADI, MPWR and ALAB.
Decided:
- competitor_of edges keep only peers inside the demo universe.
- Every relationship is stored in both directions with its inverse type: supplier_of pairs with customer_of, and competitor_of is symmetric. Without this, $graphLookup from AMD never reaches NVDA, and news about NVDA never reaches a TSM holder.
- Updated: SPEC.md Interest graph and Domain model, BACKLOG.md T02 and T11, and T05 gains a test for both directions.

**D. One live WebSocket per account on the free Alpaca plan.**
Decided:
- `LIVE_INGEST` is on for one machine only, and the other machine works from replay.
- After T18 the deployed instance is the single live ingester.
- Updated: SPEC.md Replay and recording, BACKLOG.md T10 and T18, `.env.example`.

**E. The Groq free tier is tight on tokens per minute.**
gpt-oss-120b allows 8,000 tokens per minute, and one extraction uses about 900 tokens, a third of them reasoning.
Decided:
- Each research run gets a token budget of 6,000 tokens to start, next to its step budget, tuned in T16.
- A limiter respects each provider's tokens per minute.
- Tool output is capped at 3 filing chunks per call.
- Tokens are recorded per step in the AgentRun.
- Extraction also tests a smaller Groq model if the console shows a higher tokens per minute limit.
- The research model is decided after the console numbers are in. Gemini Flash-Lite stays the fallback on a 429.
- Updated: SPEC.md Research agent, Stack and Domain model; INTERFACES.md search_filings; BACKLOG.md T04, T08, T13 and T16; STATE.md Open decisions.

**F. Embedding model and dimension.**
Decided:
- Local Xenova/all-MiniLM-L6-v2, 384 dimensions, cosine.
- Filing chunks of at most 256 tokens.
- Gemini gemini-embedding-2 at 768 dimensions is the documented upgrade path.
- Updated: SPEC.md Stack and Domain model, BACKLOG.md T02, T11 and T18 (memory check on the host).

**Demo item.** Pinned by id: DEMO_SOURCE_ID=38062166 in the seed config. Replay selects items by id, never by keyword. Updated: SPEC.md Replay and recording, BACKLOG.md T02 and T03.
