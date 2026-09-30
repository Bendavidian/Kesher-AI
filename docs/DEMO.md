# Demo and rehearsal

A five minute demo from the recorded TSMC event, on the deployed app, with the app running locally as the fallback. T18 part 2 rehearses it after T16 and T20 (docs/BACKLOG.md).

## Shared use
- **Any visitor can press Replay.** The persona password is public, so anyone who opens the deployed app can sign in and press Replay demo event. Every replay:
  - resets the demo event: its FeedItems are deleted for every user, research state included, until the replay pushes the card back;
  - stores the research gate's skipped runs in the Agent runs list.
  It calls no model once the item is extracted, and it cannot start new research within 24 hours of the last run on that card. After that, the daily budget bounds it. A cooldown of 15 seconds separates replays.
- **Do not run `npm run smoke` against a shared database while another session is working.** The api always uses the database named `kesher` (apps/api/src/db/client.ts), so today the deployed instance and both development machines share one database. A smoke run:
  - resets the demo event for every user, so the card disappears from open feeds and comes back as new;
  - signs in all three personas;
  - with Investigate, queues a deep research run on the shared daily budget.
  A session that is replaying, investigating or running `research:dev` at the same time sees cards vanish, gets a 409 or 429, or has its run queued behind the smoke's. Run it only when no one else is working, or with `--no-investigate` to leave the budget alone.

## The day before
- [ ] The deployed service runs the latest main, and render.yaml matches its settings: LIVE_INGEST false, DEMO_MODE true, LOCAL_EMBEDDINGS false.
- [ ] The keep-alive cron pinged /health in the last hour (its log shows 200).
- [ ] `npm run smoke -- --url https://<service>.onrender.com` passes, Investigate included. That spends one research run of the day's 30.
- [ ] The research budget has room: research_budget on Atlas shows the UTC day's count well under 30. It resets at 00:00 UTC, which is 03:00 in Israel.
- [ ] Groq and Gemini quotas are not near their daily limits (docs/SPIKE.md).
- [ ] The feed, report and run screens render on the deployed URL at 1440px and at 1279px.
- [ ] The demo item is already extracted on Atlas, so a replay calls no model. On a fresh database, the first replay runs the injection screen and the extraction once.
- [ ] Check the Agent runs tab for replays or runs you did not start (see Shared use below).
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
- **Deployed app down or slow to wake:** switch to the local fallback. It is the same code and the same Atlas data, and it additionally has filing search.
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
