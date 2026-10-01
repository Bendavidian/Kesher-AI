# Demo and rehearsal

A five minute demo from the recorded TSMC event, on the deployed app, with the app running locally as the fallback. T18 part 2 rehearses it after T16 and T20 (docs/BACKLOG.md).

## Shared use
- **The public instance shares the development database.** Render uses the development Atlas cluster and its `kesher` database, through its own user (Database, below). Trade-off: nothing to seed or keep in step, but development and the public app change the same data and spend the same daily research budget.
- **What development does shows on the deployed app.** Dev resets, dev replays, `research:dev` and `npm run smoke` against any URL all write to `kesher`: their FeedItems, research runs and budget use appear on the public app, and a reset removes the demo card there too. The model quotas were shared anyway: Groq and Gemini free tiers are per key, and Render uses the same keys as development (Secrets for Render, below).
- **Any visitor can press Replay.** The persona password is public, so anyone who opens the deployed app can sign in and press Replay demo event. Every replay:
  - resets the demo event: its FeedItems are deleted for every user, research state included, until the replay pushes the card back;
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

## The day before
- [ ] The deployed service runs the latest main, and render.yaml matches its settings: DEMO_MODE true, LOCAL_EMBEDDINGS false. LIVE_INGEST is the dashboard's: the footer's live line says whether it is on and connected.
- [ ] The keep-alive cron pinged /health in the last hour (its log shows 200).
- [ ] `npm run smoke -- --url https://<service>.onrender.com` passes, Investigate included. That spends one research run of the day's 30.
- [ ] The research budget has room: research_budget in `kesher` shows the UTC day's count well under 30; development runs count too. It resets at 00:00 UTC, which is 03:00 in Israel.
- [ ] Groq and Gemini quotas are not near their daily limits (docs/SPIKE.md).
- [ ] The feed, report and run screens render on the deployed URL at 1440px and at 1279px.
- [ ] The feed holds the demo event, the event library and Render's live items only: `npm run demo:library` loads nothing new, and no FeedItems are in `kesher` from development replays (Shared use, above). With live ingestion on, A and B have more than 25 cards.
- [ ] Live ingestion: the footer shows "Live · connected" and today's extractions well under 150 (Live ingestion on Render, below).
- [ ] Check the Agent runs tab for replays or runs you did not start (Shared use, above).
- [ ] The local fallback works: `git pull`, `npm install`, `npm run dev`, then sign in as A, Replay, and Investigate on localhost:5173.

## One hour before
- [ ] Open the deployed URL once, so a sleeping instance wakes up. The first request takes about a minute after a spin down.
- [ ] Sign in as A in one window, and B and C in two more (private windows, one persona each), to show the live push.
- [ ] Keep a terminal ready with `npm run dev` for the fallback.

## The five minutes
1. **The problem (30 s).** Investors drown in news, and the news that matters most can reach a holding indirectly.
2. **Replay (60 s).** As persona A (AI investor, holds NVDA), press Replay demo event.
   - The TSMC earthquake card arrives live in all three windows at once.
   - Point at the "Why you" line: TSMC supplies NVIDIA, which A holds. It is rendered by code from the graph path, and the card shows the quote from NVIDIA's 10-K.
3. **Three personas (45 s).** Switch to B: High through a direct TSM holding. Switch to C: None, and the card is not in the feed.
   - Same event, three levels.
   - Relevance is computed by code; the model only extracted TSMC and an importance of 4.
4. **Price, not cause (30 s).** The market table shows TSM and NVDA next to SMH and SPY from the previous close, delayed 15 minutes, as timing only.
5. **Investigate (60 s).** Press Investigate on A's card, then View agent run.
   - The steps stream in: the run token and its scope, each MCP tool call with its latency, the checks, the verifier, and tokens against the budget.
6. **The report (45 s).** Open the research report.
   - It shows typed claims (fact, metric, inference), each with its sources.
   - Only supported claims are shown. The removed block names the check that removed a claim.
   - It is information, not advice.
7. **Close (30 s).** Everything ran on free tiers.

## If something fails
- **Deployed app down or slow to wake:** switch to the local fallback. It is the same code on the same database, and it additionally has filing search.
- **Replay answers 429:** wait the seconds it names; the demo replay has a 15 second cooldown.
- **Investigate answers 429:** the day's research budget is spent. Open the newest earlier run from the Agent runs tab instead.
- **A run fails on a rate limit:** Investigate again, or show an earlier run.

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
