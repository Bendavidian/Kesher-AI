# Demo and rehearsal

A five minute demo from the recorded TSMC event, on the deployed app at https://kesher-5ymr.onrender.com, with the app running locally as the fallback: the rehearsal checklist for the day before, the script, and the fallback plan.

## Shared use
- **The public instance shares the development database.** Render uses the development Atlas cluster and its `kesher` database, through its own user (Database, below). Trade-off: nothing to seed or keep in step, but development and the public app change the same data and spend the same daily research budget.
- **What development does shows on the deployed app.** Dev resets, dev replays, `research:dev` and `npm run smoke` against any URL all write to `kesher`: their FeedItems, research runs and budget use appear on the public app, and a reset removes the demo card there too. The model quotas were shared anyway: Groq and Gemini free tiers are per key, and Render uses the same keys as development (Secrets for Render, below).
- **Any visitor can press Replay.** The persona password is public, so anyone who opens the deployed app can sign in and press Replay demo event. Every replay:
  - resets the demo event: its FeedItems are deleted for every persona, research state included, until the replay pushes the card back; a guest portfolio's card stays (T24), and a guest cannot press Replay;
  - stores the research gate's skipped runs in the Agent runs list.
  It calls no model once the item is extracted, and it cannot start new research within 24 hours of the last run on that card. After that, the daily budget bounds it. A cooldown of 15 seconds separates replays.
- **Render is the live ingester.** Since T19 the deployed instance runs LIVE_INGEST, so real Benzinga items and EDGAR filings reach `kesher` as they are published, next to the library. Both development machines keep `LIVE_INGEST=false` (Live ingestion on Render, below).
- **The feed carries a library of real events.** `npm run demo:library` loaded the 30 real items of the eval set into `kesher` (T23), so A and B see 25 cards each and C sees 5 (KO, JNJ and XOM), with the rest under Hidden for you. The feed is in order of arrival: until someone presses Replay, the demo card is the oldest arrival and sits at the bottom; the replay makes it a new arrival on top. The load ran no research gate and stored no runs. Run it again after a database reset; a run on a loaded database writes nothing.
- **`npm run smoke` does the same, against the deployed URL or a development server.** It resets the demo event, signs in all three personas and, with Investigate, spends one run of the shared daily budget. Do not run it while someone is presenting or rehearsing, or while another session is working.

## Database
Render connects to the development cluster as `kesher_render`, a password user with Specific Privileges `readWrite` on database `kesher` only. No code change: the api always uses the database named `kesher`. `readWrite` covers everything the api does at startup and at runtime: it creates collections and ordinary indexes, and it reads and writes documents.
- **Seed.** Nothing to do. `kesher` already holds the universe, the personas, the reviewed T11 graph and the three search indexes. Run `npm run seed` and `npm run graph:apply` from a development machine as usual; Render reads the result.
- **Network.** Render's free instances have no fixed outbound IP, so Network Access must allow `0.0.0.0/0`. The users' passwords are the only protection, so keep them long.
- **Connection string.** `mongodb+srv://kesher_render:<password>@<cluster host>/kesher?retryWrites=true&w=majority`. A password with characters such as `@`, `:` or `/` must be URL encoded. The api ignores the `/kesher` path, but it keeps the string readable.
- **A separate database later.** The steps for a separate Atlas project with its own free M0 cluster, and what its seed needs, are in this file at commit b0591df.

**Models on the deployed app.**
- **Replay calls no model.** The pinned item is already extracted in `kesher`. A new item would run the injection screen on Groq prompt guard and the extraction on Groq gpt-oss-120b, with Gemini only as the per call fallback on 429 or after two answers that failed the schema; with both out, POST /demo/replay answers 503 and the next replay resumes it with no duplicate. Live items take the same models, at most 150 news extractions a UTC day.
- **Research uses Gemini.** With its quota spent, a run waits up to three times (at most 30 seconds each), then fails as rate_limited and the card shows research failed; the next run starts on Groq while Gemini is blocked.
- **Nothing is ever charged.** Keep billing off on the Google Cloud project of the Gemini key, so a spent quota is a 429 and never a charge; Groq's free plan has no billing at all.

## Secrets for Render
Generate these new; do not reuse them from development. Each must be at least 32 characters. This command works on macOS, Linux and Windows:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
```

- **JWT_SECRET:** signs the session cookie. It must differ from development, so a cookie signed on a development machine never verifies on the public app.
- **MCP_TOKEN_SECRET:** signs research run tokens. It must differ for the same reason, and from JWT_SECRET.
- **MONGODB_URI:** the kesher_render URI above.

These are reused from development, because they identify free provider accounts rather than this instance:
- GROQ_API_KEY and GOOGLE_GENERATIVE_AI_API_KEY. They share the free daily quotas with development. A separate Gemini key from a separate Google Cloud project, with billing off, would give the public app its own Gemini quota.
- ALPACA_API_KEY_ID and ALPACA_API_SECRET_KEY, for SIP bars and the market calendar, and with LIVE_INGEST on for the news stream and its gap fill. Render then holds the one live WebSocket the free plan allows for these keys, so no development machine may turn LIVE_INGEST on.
- SEC_USER_AGENT, a name and a contact rather than a secret, for get_financial_facts and the EDGAR poller.

## The day before: rehearsal checklist
Run it from top to bottom on the deployed URL, https://kesher-5ymr.onrender.com, less than 24 hours before the demo. The Investigate below then counts as the card's recent run, so the demo's Replay attaches its report instead of starting a new run.
- [ ] **Deployed main.** The service runs the latest main (Manual Deploy), and render.yaml matches its settings: DEMO_MODE true, LOCAL_EMBEDDINGS false, LIVE_INGEST set in the dashboard.
- [ ] **Wake the service.** Open the URL and wait for the feed. After a spin down the first request takes about a minute.
- [ ] **Health.** `curl https://kesher-5ymr.onrender.com/health` answers 200 with `{"status":"ok","demoMode":true}`.
- [ ] **Keep-alive history.** On cron-job.org, the job's History shows a 200 from /health every 10 minutes over the last day, with no gap. A gap means the instance slept, and with it the live stream.
- [ ] **Live status.** The footer reads "Live · connected" and today's extractions are well under 150 ("41 of 150 extracted"); its details show the queue, the EDGAR poller and the counters. "Live ingest off" means LIVE_INGEST is false on Render (Live ingestion on Render, below). A footer with "API ok" and no live line means the deploy predates T19.
- [ ] **Replay.** As AI investor, press Replay demo event. The TSMC card arrives on top within seconds, in every open window.
- [ ] **The three personas.** AI investor: Medium 0.80, "TSMC supplies NVIDIA, which you hold", with the NVIDIA 10-K quote. Semiconductors: High 1.00, a direct TSM holding. Unrelated: the card is not in the feed.
- [ ] **One Investigate.** On AI investor's card, Investigate (or Investigate again), then View agent run, until Completed. The run shows the Verifier step with tokens ("Verifier 2.2k of 6k", never 0), and Open research report lists supported claims, the 10-K fact and the open gap metric among them. A report that reads "N claims were not verified" with a Verifier failed step means the verifier could not reach Groq: read the step's error (an "Invalid API Key" means GROQ_API_KEY on Render) and fix it before the demo.
- [ ] **The day's budget.** The newest run's Gate check names it ("research run 7 of 30 today"), or research_budget in `kesher` for the UTC day. Well under 30 is fine; development runs and `npm run smoke` count too. It resets at 00:00 UTC, 03:00 in Israel.
- [ ] **A good report in a tab.** Bookmark the report from the Investigate above. It is the fallback if a run is slow on the day.
- [ ] **Your portfolio.** Your portfolio, pick NVDA and TSM, Show my feed: cards in a few seconds. Then switch back to AI investor.
- [ ] **Agent runs.** Check the Agent runs tab for replays or runs you did not start (Shared use, above).
- [ ] **Screens.** The feed, report and run screens render at 1440px and at 1279px.
- [ ] **Quotas.** Groq and Gemini are not near their daily limits (docs/SPIKE.md).
- [ ] **Local fallback.** `git pull`, `npm install`, `npm run dev` with LIVE_INGEST false, then sign in as AI investor on localhost:5173 and open the same card.
- [ ] `npm run smoke -- --url https://kesher-5ymr.onrender.com` passes, Investigate included, if anything was deployed since the last one. It spends one research run and resets the demo card, so never run it on the day itself.

## One hour before
- [ ] Open the deployed URL once, so a sleeping instance wakes up.
- [ ] Sign in as AI investor in one window, and Semiconductors and Unrelated in two private windows, to show the live push.
- [ ] Open the bookmarked report in a tab.
- [ ] Keep a terminal with `npm run dev` running for the fallback.
- [ ] No development machine runs research, a replay or the smoke test until the demo is over.

## The five minutes
About 4:40 of script and 20 seconds of slack. Each step says what to click and what to say.

1. **The problem (0:20).**
   - Click: nothing; the AI investor window is on screen.
   - Say: "Investors drown in market news, and the news that matters most often reaches a holding indirectly, through a supplier or a customer. Kesher learns your portfolio and tells you which events reach it, and exactly why."
2. **Replay (0:50).**
   - Click: Replay demo event in the top bar, then the TSMC card when it lands on top.
   - Say: "This is a real Benzinga headline from April 2024, replayed through the same pipeline as live news. The card has just arrived in all three windows at once." Point at Why this reached you: "This line is rendered by code from the graph path: TSMC supplies NVIDIA, and NVIDIA is in this portfolio. The edge comes from NVIDIA's own 10-K, quoted here and reviewed by hand. No evidence, no edge."
3. **Three personas (0:45).**
   - Click: Semiconductors, then Unrelated, then back to AI investor.
   - Say, one line each: "The AI investor gets Medium 0.80, through the supplier." "The semiconductor investor holds TSMC itself: High 1.00." "The unrelated investor holds Coca-Cola, J&J and Exxon: the card never shows up." Then: "Same event, three answers. The model only extracted TSMC and an importance of 4 out of 5; relevance and confidence are computed by code."
4. **Price, not cause (0:20).**
   - Click: nothing; point at Market around the headline.
   - Say: "TSM and NVDA next to SMH and SPY, from the previous close, delayed 15 minutes. It shows what moved at the same time, not why."
5. **Investigate and the run (1:00).**
   - Click: Investigate again on the card (Investigate this event if it has no report yet), then View agent run. If the button already reads Investigating…, the research gate has started a run on its own: click View agent run.
   - Say, while the steps stream in: "The research agent runs with a token scoped to this user and seven read only tools, valid for five minutes; it never sees a user id it could change. Code writes the 10-K fact and the price metric first. Every tool call, its latency and its tokens are here, then the deterministic checks, then a separate verifier on another model with no tools. Everything ran on free tiers: cost zero."
   - Click: the Run token issued step, to show the allowed tools.
6. **The report (0:40).**
   - Click: Research report in the breadcrumb (or Open research report on the card).
   - Say: "Typed claims: facts quoted from a source, metrics checked against market data, inferences built on other claims. Only supported claims are shown; anything a check removed is counted, never shown. And it is information, not advice: a code check removes any buy or sell language."
7. **Your portfolio (0:30).**
   - Click: Your portfolio in the switcher, pick two or three companies (NVDA and TSM, or the audience's picks), Show my feed.
   - Say: "Any visitor can try their own holdings. The same code scores every stored event against them in a few seconds, with no model call. The guest portfolio is deleted after 24 hours."
8. **Close (0:15).**
   - Click: nothing.
   - Say: "Measured on 30 real items labeled by hand: relevance agrees on 78 of 90 pairs. The verifier caught 17 of 17 planted errors. With the injection screen, one of five poisoned items changed the extraction, and none removed a card. All of it on free tiers, for zero dollars." (docs/EVALS.md)

## Fallback plan
- **Gemini is slow or a run hangs.** Do not wait past a minute. Open the bookmarked report, or the existing report on AI investor's card (Open research report), and its run from View agent run there or from Agent runs, Recent runs. Say that research runs on a free model tier and an earlier run is shown. A run that fails on a rate limit leaves "The last research run ended without a report." on the card; the same fallback applies.
- **Render is down or does not wake.** Switch to the local app, which is the same code on the same `kesher` database, so the same cards, runs and reports, plus filing search:
  1. In the terminal kept ready, `npm run dev` is already running; otherwise start it (LIVE_INGEST false).
  2. Open http://localhost:5173, choose AI investor, and continue the script from where it stopped. Replay demo event and Investigate work the same.
- **The day's research budget is spent.** Investigate answers with "Today's research budget is spent (30 of 30 runs). It resets at 00:00 UTC." under the button, and changes nothing. Say that the daily budget is a guard that keeps every call on the free tier, then show the bookmarked report and its run instead of step 5. Your portfolio needs no budget. To keep it from happening, run nothing that researches from development on the day (Shared use, above).
- **Replay answers 429.** Wait the seconds it names: replays have a 15 second cooldown.
- **The card does not arrive in the other windows.** Reload them; the card is already in each feed.

## Live ingestion on Render
Since T19 the deployed instance is the one live ingester (SPEC.md decision log, T19). The free Alpaca plan allows one live WebSocket per account and Render uses the development keys, so the Mac mini and the Windows laptop keep `LIVE_INGEST=false` in their .env, always.

**Before turning it on**
- [ ] T19 is merged and deployed: Manual Deploy of the latest main, then `npm run smoke -- --url https://<service>.onrender.com` passes.
- [ ] On the Mac mini and on the Windows laptop, `.env` has `LIVE_INGEST=false` or no LIVE_INGEST line. A machine with it on takes the WebSocket, and Render's log then says "connection limit exceeded; is LIVE_INGEST on for another machine?" at every retry.
- [ ] The keep-alive cron pinged /health in the last hour. A sleeping instance stops the stream; when it wakes, the gap fill brings back at most the last 60 minutes of news.
- [ ] Render's Environment holds ALPACA_API_KEY_ID, ALPACA_API_SECRET_KEY and SEC_USER_AGENT; with LIVE_INGEST on the api does not start without them.
- [ ] The memory measured in T19 leaves room under 512 MB (SPEC.md decision log, T19).

**Turning it on**
1. In the Render dashboard, open the kesher service, then Environment. Set LIVE_INGEST to `true` and save; Render restarts the service with it. render.yaml leaves LIVE_INGEST to the dashboard (`sync: false`), so a Blueprint sync never sets it back.
2. In Logs, within a minute: the start line ends with "live ingest on", then "alpaca news stream subscribed", and no "connection limit exceeded".
3. Sign in on the deployed URL. The footer reads "Live · connected"; its details show the day's extractions of 150, the queue, the EDGAR poller and the counters.
4. In US market hours (9:30 to 16:00 ET, 16:30 to 23:00 in Israel, one hour earlier while the two clocks change on different dates), a Benzinga item on a universe symbol reaches the feed within minutes with no manual action. Outside them items are rare, and a reconnect after 10 silent minutes is normal.

**Watching it**
- Metrics: memory stays under 512 MB.
- Logs and the footer details: "live queue full", "past today's extraction cap", "failed its schema" and "edgar answered 429" mean a limit was reached; each one is counted.
- Groq: 150 live news extractions a UTC day use about 122,000 of Groq's 200,000 daily tokens; replays and the verifier use the rest.
- Research: a live card with relevance at least 0.6 and importance at least 4 starts an automatic run, at most 20 a day from the shared budget of 30, so at least 10 stay for Investigate.

**Rollback**
1. In Environment, set LIVE_INGEST to `false` and save. Render restarts without the stream and the poller, and the footer reads "Live ingest off".
2. Nothing else to undo: live recordings, events and cards stay in `kesher` as real items, and replay works on them.
3. If the service fails to start or restarts in a loop, Manual Deploy the previous commit from the dashboard, with LIVE_INGEST false.
4. The development machines stay at `LIVE_INGEST=false` either way. To run the live path on one of them, set it to false on Render first.

## Live Benzinga item (part 2, US market hours)
T10 proved the live path with an EDGAR 8-K and with fake WebSocket tests. This step observes a real Benzinga item, on the deployed instance once live ingestion is on there (Live ingestion on Render, above).
- [ ] Pick a US trading day and a window inside 9:30 to 16:00 ET.
- [ ] Sign in on the deployed URL as a persona that holds a busy name (A for NVDA or MSFT), and watch the footer's last item time and Render's log.
- [ ] Wait for a Benzinga item on a universe symbol to reach the feed with no manual action.
- [ ] Note its Alpaca news id, the time it arrived, and the card's relevance. `npm run recording:export -- --id <id>` on a development machine keeps it for the evals if it is useful; it reads the recordings collection in `kesher`.
