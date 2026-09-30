# Demo and rehearsal

A five minute demo from the recorded TSMC event, on the deployed app, with the app running locally as the fallback. T18 part 2 rehearses it after T16 and T20 (docs/BACKLOG.md).

## Shared use
- **The public instance shares the development database.** Render uses the development Atlas cluster and its `kesher` database, through its own user (Database, below). Trade-off: nothing to seed or keep in step, but development and the public app change the same data and spend the same daily research budget.
- **What development does shows on the deployed app.** Dev resets, dev replays, `research:dev`, `npm run smoke` against any URL and `LIVE_INGEST=true` on a development machine all write to `kesher`: their FeedItems, research runs and budget use appear on the public app, and a reset removes the demo card there too. The model quotas were shared anyway: Groq and Gemini free tiers are per key, and Render uses the same keys as development (Secrets for Render, below).
- **Any visitor can press Replay.** The persona password is public, so anyone who opens the deployed app can sign in and press Replay demo event. Every replay:
  - resets the demo event: its FeedItems are deleted for every persona, research state included, until the replay pushes the card back; a guest portfolio's card stays (T24), and a guest cannot press Replay;
  - stores the research gate's skipped runs in the Agent runs list.
  It calls no model once the item is extracted, and it cannot start new research within 24 hours of the last run on that card. After that, the daily budget bounds it. A cooldown of 15 seconds separates replays.
- **`npm run smoke` does the same, against the deployed URL or a development server.** It resets the demo event, signs in all three personas and, with Investigate, spends one run of the shared daily budget. Do not run it while someone is presenting or rehearsing, or while another session is working.

## Database
Render connects to the development cluster as `kesher_render`, a password user with Specific Privileges `readWrite` on database `kesher` only. No code change: the api always uses the database named `kesher`. `readWrite` covers everything the api does at startup and at runtime: it creates collections and ordinary indexes, and it reads and writes documents.
- **Seed.** Nothing to do. `kesher` already holds the universe, the personas, the reviewed T11 graph and the three search indexes. Run `npm run seed` and `npm run graph:apply` from a development machine as usual; Render reads the result.
- **Network.** Render's free instances have no fixed outbound IP, so Network Access must allow `0.0.0.0/0`. The users' passwords are the only protection, so keep them long.
- **Connection string.** `mongodb+srv://kesher_render:<password>@<cluster host>/kesher?retryWrites=true&w=majority`. A password with characters such as `@`, `:` or `/` must be URL encoded. The api ignores the `/kesher` path, but it keeps the string readable.
- **A separate database later.** The steps for a separate Atlas project with its own free M0 cluster, and what its seed needs, are in this file at commit b0591df.

**Models on the deployed app.**
- **Replay calls no model.** The pinned item is already extracted in `kesher`. A new item would run the injection screen on Groq prompt guard and the extraction on Groq gpt-oss-120b, with Gemini only as the per call fallback on 429; with both out, POST /demo/replay answers 503 and the next replay resumes it with no duplicate.
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
- ALPACA_API_KEY_ID and ALPACA_API_SECRET_KEY, for SIP bars and the market calendar. LIVE_INGEST is false on Render, so they never open the one live WebSocket the free plan allows.
- SEC_USER_AGENT, a name and a contact rather than a secret, for get_financial_facts.

## The day before
- [ ] The deployed service runs the latest main, and render.yaml matches its settings: LIVE_INGEST false, DEMO_MODE true, LOCAL_EMBEDDINGS false.
- [ ] The keep-alive cron pinged /health in the last hour (its log shows 200).
- [ ] `npm run smoke -- --url https://<service>.onrender.com` passes, Investigate included. That spends one research run of the day's 30.
- [ ] The research budget has room: research_budget in `kesher` shows the UTC day's count well under 30; development runs count too. It resets at 00:00 UTC, which is 03:00 in Israel.
- [ ] Groq and Gemini quotas are not near their daily limits (docs/SPIKE.md).
- [ ] The feed, report and run screens render on the deployed URL at 1440px and at 1279px.
- [ ] The demo feed holds the demo event only: no FeedItems of other events in `kesher` from development replays or live ingestion (Shared use, above).
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

## Live Benzinga item (part 2, US market hours)
T10 proved the live path with an EDGAR 8-K and with fake WebSocket tests. This step observes a real Benzinga item. The deployed instance stays replay only.
- [ ] Pick a US trading day and a window inside 9:30 to 16:00 ET (16:30 to 23:00 in Israel, one hour earlier while the US and Israel clocks change on different dates).
- [ ] On one development machine only, set `LIVE_INGEST=true` in its .env. It stays false on the other machine and on the deployed instance: the free Alpaca plan allows one live WebSocket.
- [ ] Start `npm run dev` and sign in as a persona that holds a busy name (A for NVDA or MSFT).
- [ ] Watch the api log for the stream's subscribe line and pre filter counts. Wait for a Benzinga item on a universe symbol to reach the feed with no manual action.
- [ ] Note its Alpaca news id, the time it arrived, and the card's relevance. `npm run recording:export -- --id <id>` keeps it for the evals if it is useful.
- [ ] Set `LIVE_INGEST=false` again and restart the api.
