# Eval event candidates for T16

Background research, not a backlog task. 30 real news items from 2024 to 2026, found through the Alpaca news REST API (no WebSocket) with `research/events/search.ts` and listed in `research/events/candidates.ts`. `npx tsx research/events/report.ts` fetches every item again by source id and writes this file, so id, time, headline and symbols are exactly what Alpaca returns; bold symbols are in the demo universe.

**Every label is proposed and unreviewed.** Labels follow the relevance rule in SPEC.md ("Scores"): the best path from an event company to a holding. A holding scores 1, one hop scores the edge weight (supplier or customer 0.8, competitor 0.6, same sector 0.4, shared theme 0.3), and two hops multiply both weights by 0.7. Supplier, customer and competitor edges are the evidence candidates in `docs/research/edge-candidates.md`, used in both directions. Proposed mapping: **high** at 0.8 or more (a holding, or one supplier or customer hop), **medium** from 0.4 to below 0.8, **none** below 0.4.

Personas: A, AI investor: NVDA, MSFT, AMZN. B, Semiconductor investor: AMD, AVGO, TSM, ASML. C, Unrelated investor: KO, JNJ, XOM.

## Coverage

| Event type | Items |
|---|---|
| earnings | 5 |
| guidance | 4 |
| production_disruption | 5 |
| regulation | 6 |
| analyst_action | 5 |
| merger | 5 |

| Persona | high | medium | none |
|---|---|---|---|
| A | 14 | 11 | 5 |
| B | 18 | 1 | 11 |
| C | 5 | 0 | 25 |

5 items reach only persona C (KO, JNJ or XOM news that must not reach A or B).

## Candidates

| # | Source id | created_at | Headline | Symbols | Type | A (NVDA, MSFT, AMZN) | B (AMD, AVGO, TSM, ASML) | C (KO, JNJ, XOM) |
|---|---|---|---|---|---|---|---|---|
| 1 | 38062166 | 2024-04-03T03:57:09Z | TSMC Suspends Chip Production After Taiwan Rocked By Strongest Tremor In 25 Years | **TSM** | production_disruption | high (proposed): TSM supplier_of NVDA, 0.8 | high (proposed): holds TSM | none (proposed): no path from a tech company to KO, JNJ or XOM |
| 2 | 40113523 | 2024-08-01T20:01:54Z | Intel Q2 Adj $0.02 Misses $0.10 Estimate, Sales $12.83B Miss $12.94B Estimate | **INTC** | earnings | medium (proposed): INTC competitor_of NVDA, MSFT and AMZN, 0.6 | high (proposed): INTC customer_of TSM and of ASML, 0.8 | none (proposed): no path from a tech company to KO, JNJ or XOM |
| 3 | 42472206 | 2024-12-12T21:15:32Z | Broadcom Q4 2024 Adj. EPS $1.42 Beats $1.38 Estimate, Sales $14.054B Miss $14.091B Estimate | **AVGO** | earnings | medium (proposed): AVGO competitor_of NVDA, 0.6 | high (proposed): holds AVGO | none (proposed): no path from a tech company to KO, JNJ or XOM |
| 4 | 43020311 | 2025-01-16T05:56:57Z | Taiwan Semiconductor Q4 GAAP EPS $2.24 Beats $2.16 Estimate, Sales $26.88B Beat $26.38B Estimate | **TSM** | earnings | high (proposed): TSM supplier_of NVDA, 0.8 | high (proposed): holds TSM | none (proposed): no path from a tech company to KO, JNJ or XOM |
| 5 | 43320124 | 2025-01-29T21:30:21Z | Microsoft Shares Slide After Q2 Results, Cloud Revenue Misses Expectations: Details | **MSFT** | earnings | high (proposed): holds MSFT | none (proposed): best path MSFT→NVDA→TSM (competitor 0.6 × customer 0.8 × 0.7) is 0.34 | none (proposed): no path from a tech company to KO, JNJ or XOM |
| 6 | 43618741 | 2025-02-11T11:55:39Z | Coca-Cola Q4 2024 Adj. EPS $0.55 Beats $0.52 Estimate, Sales $11.5B Beat $10.677B Estimate | **KO** | earnings | none (proposed): no path from KO, JNJ or XOM to a tech company | none (proposed): no path from KO, JNJ or XOM to a tech company | high (proposed): holds KO |
| 7 | 38973532 | 2024-05-22T20:21:22Z | Nvidia Sees Q2 2025 Revenue $28B +/- 2% Vs $26.64B Estimate | **NVDA** | guidance | high (proposed): holds NVDA | high (proposed): NVDA customer_of TSM (inverse of TSM supplier_of NVDA), 0.8 | none (proposed): no path from a tech company to KO, JNJ or XOM |
| 8 | 41336021 | 2024-10-15T14:35:01Z | ASML Holding NV 3Q Bookings €2.63 Billion, Est. €5.39 Billion; Sees 2025 Net Sales €30 Billion To €35 Billion, Est. €35.94 Billion | **ASML** | guidance | medium (proposed): same sector as NVDA, 0.4; without a sector edge ASML→INTC→NVDA is 0.34 | high (proposed): holds ASML | none (proposed): no path from a tech company to KO, JNJ or XOM |
| 9 | 41663854 | 2024-10-31T20:04:20Z | Amazon Sees Q4 Net Sales $181.5B-$188.5B | **AMZN** | guidance | high (proposed): holds AMZN | none (proposed): best path AMZN→NVDA→TSM (competitor 0.6 × customer 0.8 × 0.7) is 0.34 | none (proposed): no path from a tech company to KO, JNJ or XOM |
| 10 | 42563518 | 2024-12-18T21:02:40Z | Micron Sees Q2 Revenue $7.7B-$8.1B vs $9.00B Est; Adj. EPS $1.33-$1.53 vs $1.92 Est | **MU** | guidance | high (proposed): MU supplier_of NVDA, 0.8 | medium (proposed): MU→NVDA→TSM (supplier 0.8 × customer 0.8 × 0.7) is 0.45 | none (proposed): no path from a tech company to KO, JNJ or XOM |
| 11 | 39854612 | 2024-07-19T08:23:52Z | Windows PCs Crash Worldwide With Users Experiencing Blue Screen Of Death Issue, CrowdStrike Confirms Defect: 'Fix Has Been Deployed' (UPDATED) | **MSFT**, CRWD | production_disruption | high (proposed): holds MSFT | none (proposed): best path MSFT→NVDA→TSM (competitor 0.6 × customer 0.8 × 0.7) is 0.34 | none (proposed): no path from a tech company to KO, JNJ or XOM |
| 12 | 40152477 | 2024-08-05T04:08:31Z | Nvidia Upcoming Chip Launch Faces Delay Due To Design Flaws — Setback Expected To Impact Meta, Microsoft And Google: Report (UPDATED) | **GOOGL**, **META**, **MSFT**, **NVDA**, GOOG | production_disruption | high (proposed): holds NVDA and MSFT (both tagged) | high (proposed): NVDA customer_of TSM (inverse of TSM supplier_of NVDA), 0.8 | none (proposed): no path from a tech company to KO, JNJ or XOM |
| 13 | 43088007 | 2025-01-21T01:29:23Z | Nvidia, Apple-Supplier TSMC Halts Production As 6.4 Magnitude Earthquake Strikes Taiwan | **NVDA**, **TSM**, AAPL | production_disruption | high (proposed): holds NVDA, which the item tags with TSM | high (proposed): holds TSM | none (proposed): no path from a tech company to KO, JNJ or XOM |
| 14 | 48297781 | 2025-10-20T10:16:05Z | 'Major AWS Outage Takes Down Fortnite, Alexa, Snapchat, And More' - The Verge | **AMZN**, COIN, SNAP | production_disruption | high (proposed): holds AMZN | none (proposed): best path AMZN→NVDA→TSM (competitor 0.6 × customer 0.8 × 0.7) is 0.34 | none (proposed): no path from a tech company to KO, JNJ or XOM |
| 15 | 40169246 | 2024-08-05T18:47:08Z | Google Loses DOJ Antitrust Suit Over Search; Judge Finds Search Giant Violated Antitrust Law | **GOOGL**, GOOG | regulation | medium (proposed): GOOGL competitor_of NVDA, 0.6 | none (proposed): best path GOOGL→NVDA→TSM (competitor 0.6 × customer 0.8 × 0.7) is 0.34 | none (proposed): no path from a tech company to KO, JNJ or XOM |
| 16 | 40748050 | 2024-09-06T12:12:24Z | ASML's Advanced Chip Tool Faces Dutch Export Restrictions Amid US Controls | **ASML** | regulation | medium (proposed): same sector as NVDA, 0.4; without a sector edge ASML→INTC→NVDA is 0.34 | high (proposed): holds ASML | none (proposed): no path from a tech company to KO, JNJ or XOM |
| 17 | 42276889 | 2024-12-02T21:11:53Z | Lam Research Corporation Comments On Newly Announced Export Regulations; Says "Our Initial Assessment Is That The Effect Of The Announced Measures On Lam's Business Will Be Broadly Consistent With Our Prior Expectations" | **LRCX** | regulation | medium (proposed): LRCX→TSM→NVDA and LRCX→MU→NVDA (supplier 0.8 × 0.8 × 0.7) are 0.45 | high (proposed): LRCX supplier_of TSM (inverse of TSM customer_of LRCX), 0.8 | none (proposed): no path from a tech company to KO, JNJ or XOM |
| 18 | 44578823 | 2025-04-01T07:17:14Z | Reported Earlier, Johnson & Johnson Shifts Focus Back To Tort System, Will Litigate Talc Claims After Bankruptcy Court Denial | **JNJ** | regulation | none (proposed): no path from KO, JNJ or XOM to a tech company | none (proposed): no path from KO, JNJ or XOM to a tech company | high (proposed): holds JNJ |
| 19 | 44828104 | 2025-04-15T21:27:37Z | The U.S. Government Informed Nvidia That The USG Requires A License For Export To China (Including Hong Kong And Macau) And D:5 Countries The Company's H20 Integrated Circuits And Any Other Circuits Achieving The H20's Memory Bandwidth, Interconnect Bandwidth; The USG Informed The Company That The License Requirement Will Be In Effect For The Indefinite Future; Q1 Results Are Expected To Include Up To ~$5.5B Of Charges Associated With H20 Products For Inventory, Purchase Commitments, And Related Reserves | **NVDA**, FXI, SPY | regulation | high (proposed): holds NVDA | high (proposed): NVDA customer_of TSM (inverse of TSM supplier_of NVDA), 0.8 | none (proposed): no path from a tech company to KO, JNJ or XOM |
| 20 | 44837834 | 2025-04-16T13:12:26Z | AMD Completes Initial Assessment Of New U.S. Export Controls Impacting MI308 Chip Sales To China And D:5 Countries, Expects To Apply For Licenses Amid Uncertainty And Anticipates Up To $800M In Potential Charges From Inventory, Purchase Commitments, And Reserves | **AMD** | regulation | medium (proposed): AMD competitor_of NVDA, 0.6 | high (proposed): holds AMD | none (proposed): no path from a tech company to KO, JNJ or XOM |
| 21 | 39245673 | 2024-06-10T09:10:53Z | Morgan Stanley Downgrades Advanced Micro Devices to Equal-Weight, Maintains Price Target to $176 | **AMD** | analyst_action | medium (proposed): AMD competitor_of NVDA, 0.6 | high (proposed): holds AMD | none (proposed): no path from a tech company to KO, JNJ or XOM |
| 22 | 39646124 | 2024-07-05T12:51:31Z | New Street Research Downgrades NVIDIA to Neutral | **NVDA** | analyst_action | high (proposed): holds NVDA | high (proposed): NVDA customer_of TSM (inverse of TSM supplier_of NVDA), 0.8 | none (proposed): no path from a tech company to KO, JNJ or XOM |
| 23 | 42456879 | 2024-12-12T11:42:24Z | Deutsche Bank Upgrades Coca-Cola to Buy, Raises Price Target to $70 | **KO** | analyst_action | none (proposed): no path from KO, JNJ or XOM to a tech company | none (proposed): no path from KO, JNJ or XOM to a tech company | high (proposed): holds KO |
| 24 | 42482634 | 2024-12-13T13:05:51Z | Evercore ISI Group Maintains Outperform on Broadcom, Raises Price Target to $250 | **AVGO** | analyst_action | medium (proposed): AVGO competitor_of NVDA, 0.6 | high (proposed): holds AVGO | none (proposed): no path from a tech company to KO, JNJ or XOM |
| 25 | 44859693 | 2025-04-17T10:49:56Z | Keybanc Downgrades Microsoft to Sector Weight | **MSFT** | analyst_action | high (proposed): holds MSFT | none (proposed): best path MSFT→NVDA→TSM (competitor 0.6 × customer 0.8 × 0.7) is 0.34 | none (proposed): no path from a tech company to KO, JNJ or XOM |
| 26 | 38612606 | 2024-05-03T12:45:17Z | ExxonMobil Completes Acquisition of Pioneer Natural Resources | **XOM**, PXD | merger | none (proposed): no path from KO, JNJ or XOM to a tech company | none (proposed): no path from KO, JNJ or XOM to a tech company | high (proposed): holds XOM |
| 27 | 40436151 | 2024-08-19T10:04:20Z | AMD To Snap Hyperscale Solutions Provider ZT Systems For $4.9B Plus Potential Earnout Of Up To $400M, To Be Accretive On Adjusted Basis By 2025 End | **AMD** | merger | medium (proposed): AMD competitor_of NVDA, 0.6 | high (proposed): holds AMD | none (proposed): no path from a tech company to KO, JNJ or XOM |
| 28 | 40964871 | 2024-09-20T19:26:53Z | Wall Street Journal Reported Qualcomm Approached Intel About A Takeover | **INTC**, **QCOM** | merger | medium (proposed): QCOM and INTC competitor_of NVDA, 0.6 | high (proposed): QCOM and INTC customer_of TSM, 0.8 | none (proposed): no path from a tech company to KO, JNJ or XOM |
| 29 | 42940226 | 2025-01-13T11:33:50Z | Johnson & Johnson Has Agreed To Acquire Intra-cellular Therapies For $132.00 Per Share In Cash For A Total Equity Value Of Approximately $14.6B | **JNJ**, ITCI | merger | none (proposed): no path from KO, JNJ or XOM to a tech company | none (proposed): no path from KO, JNJ or XOM to a tech company | high (proposed): holds JNJ |
| 30 | 47734379 | 2025-09-18T11:04:01Z | Nvidia And Intel To Jointly Develop AI Infrastructure And Personal Computing Products, Nvidia To Invest $5B In Intel's Stock At $23.28 Per Share | **INTC**, **NVDA** | merger | high (proposed): holds NVDA | high (proposed): NVDA and INTC customer_of TSM, 0.8 | none (proposed): no path from a tech company to KO, JNJ or XOM |

## Notes

- #1, 38062166: The pinned demo item (DEMO_SOURCE_ID).
- #2, 40113523: Nobody holds INTC; it reaches both tech personas through the graph only.
- #8, 41336021: Bookings miss and a lower 2025 range, published a day early.
- #11, 39854612: CrowdStrike update crashes Windows; CRWD is not in the universe.
- #12, 40152477: Blackwell delay; tags GOOG, GOOGL and META as well.
- #13, 43088007: A second Taiwan earthquake: the same kind of event as the demo, a separate cluster.
- #14, 48297781: AWS us-east-1 outage, first item of the cluster.
- #15, 40169246: Nobody holds GOOGL; tests how far a competitor edge should carry.
- #17, 42276889: Nobody holds LRCX; the only two hop supply path for A. Lam calls the impact expected.
- #18, 44578823: Bankruptcy court rejects the talc plan; the first item Alpaca has for it.
- #19, 44828104: H20 export license requirement and a charge of up to $5.5B.
- #20, 44837834: Same export rule as the H20 item, seen from AMD: a cross persona pair.
- #24, 42482634: Routine: rating maintained, target raised. Rubric importance 1, so no research.
- #28, 40964871: A reported approach, not a deal.
- #30, 47734379: Strategic equity investment and product partnership, not an acquisition.

## Points to review

- B is high on every NVDA item through `NVDA customer_of TSM` at 0.8, the inverse of the supplier edge. SPEC.md wants NVDA news to reach TSM holders; whether a routine NVDA rating change should be high for them is a weight question for T16.
- The ASML items are medium for A only if T11 puts ASML and NVDA in the same sector from the Finnhub profiles. Without that edge the best path is ASML→INTC→NVDA at 0.34, which is none.
- Items that tag several universe companies (the Blackwell delay, the Qualcomm approach, the NVIDIA investment in Intel) were labeled from every tagged company; extraction may find fewer, which changes the path.
- B is bimodal under this rule: NVDA, INTC and QCOM are TSM customers, so their news is high for B, and AI and cloud news is none. Only the Micron item is medium (two supply hops).
- MSFT, AMZN and GOOGL items do not reach B: the only paths run through a competitor edge and then a customer edge (0.34).
- Replay lookup: Alpaca applies `start` and `end` to `updated_at`, not `created_at`, and has no id filter. 3 of these items were updated more than a minute after publication and are invisible in a window around their created_at: 38062166 (created 2024-04-03T03:57:09Z, updated 2024-04-03T04:01:37Z); 39854612 (created 2024-07-19T08:23:52Z, updated 2024-07-19T10:59:47Z); 40152477 (created 2024-08-05T04:08:31Z, updated 2024-08-05T04:52:30Z). `research/events/candidates.ts` stores updated_at for every item, and replay by source id needs it too.
