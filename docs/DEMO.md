# Demo and rehearsal

A five minute demo from the recorded TSMC event, on the deployed app, with the app running locally as the fallback. T18 part 2 rehearses it after T16 and T20 (docs/BACKLOG.md).

## Shared use
- **The public instance has its own database.** It runs on a separate Atlas project with its own free M0 cluster (Public database, below). Dev resets, dev replays, `research:dev` and `npm run smoke` against a development server no longer touch it, and its daily research budget is its own. The model quotas are not separate: Groq and Gemini free tiers are per key, and Render uses the same keys as development (Secrets for Render, below).
- **Any visitor can press Replay.** The persona password is public, so anyone who opens the deployed app can sign in and press Replay demo event. On the public database, every replay:
  - resets the demo event: its FeedItems are deleted for every user, research state included, until the replay pushes the card back;
  - stores the research gate's skipped runs in the Agent runs list.
  It calls no model once the item is extracted, and it cannot start new research within 24 hours of the last run on that card. After that, the daily budget bounds it. A cooldown of 15 seconds separates replays.
- **`npm run smoke` against the deployed URL does the same to the public database.** It resets the demo event, signs in all three personas and, with Investigate, spends one run of the public daily budget. Do not run it while someone is presenting or rehearsing on the deployed app. Against a development server it touches the development database only; do not run it there while another session is working, for the same reasons.

## Public database
A separate Atlas project with its own free M0 cluster, so the public instance never shares data with development. No code change: the api always uses the database named `kesher`, and a different cluster is simply a different MONGODB_URI. The free tier allows one M0 cluster per project, and a new project is free.

1. **Project.** In Atlas, open the project list and choose New Project. Name it `kesher-public`, add no members, and create it.
2. **Cluster.**
   - Choose Create cluster, then Free (M0).
   - Provider AWS, region Frankfurt (eu-central-1), to match Render's frankfurt. If the free tier does not offer Frankfurt, take the closest European AWS region it does offer, and leave render.yaml at frankfurt.
   - Name it `kesher-public`.
   - Untick the sample dataset. On the development cluster, the sample data held one of the three M0 search index slots until it was dropped (T13 part 2), and seed needs all three.
3. **Users.** Under Database Access, add two password users:
   - `kesher-render`: Specific Privileges, `readWrite` on database `kesher`, collection left empty. Only Render uses it. `readWrite` covers everything the api does at startup and at runtime: it creates collections and ordinary indexes, and it reads and writes documents.
   - `kesher-setup`: built-in role Atlas admin, with Temporary User switched on for 6 hours. It runs the seed once. Seed creates the three Atlas Search indexes, and a user with `readWrite` on one database may be refused `createSearchIndexes`.
   - Let Atlas generate each password and keep it in a password manager. A password with characters such as `@`, `:` or `/` must be URL encoded in the URI.
4. **Network.** Under Network Access, add `0.0.0.0/0` (Allow access from anywhere). Render's free instances have no fixed outbound IP. The users' passwords are the only protection, so keep them long.
5. **Connection strings.** Under Connect, then Drivers, copy the `mongodb+srv://` string for the cluster. Make two versions:
   - `mongodb+srv://kesher-setup:<password>@<cluster host>/kesher?retryWrites=true&w=majority`
   - `mongodb+srv://kesher-render:<password>@<cluster host>/kesher?retryWrites=true&w=majority`

   The api ignores the `/kesher` path, but it keeps the string readable.
6. **Seed once, from a development machine.** Use a checkout of main after T18 part 1 is merged, at the repo root. Set the setup URI in the shell only, never in .env. The scripts load .env, but a variable already set in the shell wins, so the dev MONGODB_URI stays unused. `read -rs` keeps the password out of the shell history.

   On macOS (zsh) or Git Bash:

   ```bash
   read -rs MONGODB_URI && export MONGODB_URI
   ```

   Paste the kesher-setup URI and press Enter; nothing is echoed. Then:

   ```bash
   npm run seed
   ```

   ```bash
   npm run graph:apply -- --dry-run
   ```

   ```bash
   npm run graph:apply
   ```

   ```bash
   unset MONGODB_URI
   ```

   On Windows PowerShell 7, set it with `$env:MONGODB_URI = Read-Host -MaskInput`, run the same three commands, then `Remove-Item Env:MONGODB_URI`.

   What each step does and prints:
   - `npm run seed` writes the 17 universe companies, the three personas, the four seeded filing Sources and the six seeded edges with their inverses, runs the backfills (nothing to backfill on a new database), and creates the three search indexes. Its table shows them created and PENDING.
   - `graph:apply` writes the relationships the user accepted in T11 (data/graph/reviews.json) and their filing Sources. It reports 28 distinct reviewed relationships, the same graph the demo was tested on.
   - The dry run should list the same plan and write nothing.
7. **Wait for the indexes.** In the cluster's Atlas Search tab, wait until all three read READY, usually a few minutes. The api needs only `sources_text` (the word list of search_news) while LOCAL_EMBEDDINGS is false; the two vector indexes stay unused.
8. **Remove the setup user.** Delete `kesher-setup` under Database Access, or let it expire.
9. **Render.** Set MONGODB_URI to the kesher-render URI when the Blueprint asks for it.

**What the seed and graph:apply need.** Read from the code (apps/api/src/seed/run.ts and seed.ts, backfill.ts, build.ts, and apps/api/src/graph/apply-cli.ts and apply.ts):
- The only environment variable either reads is MONGODB_URI.
- The only network connection is MongoDB.
- The seed reads recordings/alpaca from disk for the publisher backfill, and hashes the demo password with scrypt.
- graph:apply reads data/graph/candidates.json and data/graph/reviews.json.
- Neither imports the model client or the embedding model, and neither calls Groq, Gemini, Alpaca, Finnhub or SEC. The modules they import that can fetch (ingest/alpaca.ts, graph/finnhub.ts) are used only for pure helpers (toIncomingItem, peerKey).
- Nothing is billed.

**The first replay on the public database.**
- **Extraction.** The pinned item is not extracted there yet, so the first Replay (or the first smoke run) runs the injection screen on Groq prompt guard and the extraction on Groq gpt-oss-120b, once. Gemini is only the per call fallback when Groq answers 429, so a spent Gemini quota does not matter while Groq has room.
- **When both providers are out.** If Groq also answers 429, POST /demo/replay answers 503: "the model providers are rate limited; replay again later".
  - The Source is stored without an extraction, and the next replay resumes it with no duplicate.
  - A screen that fails leaves the label empty and never blocks the extraction.
- **Research after the first replay.** The first scored replay also lets the gate start one automatic research run each for A and B, since the new database has no recent runs. Those runs use Gemini. With its quota spent:
  - a run waits up to three times (at most 30 seconds each), then fails as rate_limited, and the card shows research failed;
  - the next run starts on Groq while Gemini is blocked.
- **Nothing is ever charged.** Keep billing off on the Google Cloud project of the Gemini key, so a spent quota is a 429 and never a charge; Groq's free plan has no billing at all.
- **Warm it up.** Press Replay once yourself right after the first deploy, before anyone else sees the app, then run the smoke.

## Secrets for Render
Generate these new; do not reuse them from development. Each must be at least 32 characters. This command works on macOS, Linux and Windows:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
```

- **JWT_SECRET:** signs the session cookie. It must differ from development, so a cookie signed on a development machine never verifies on the public app.
- **MCP_TOKEN_SECRET:** signs research run tokens. It must differ for the same reason, and from JWT_SECRET.
- **MONGODB_URI:** the kesher-render URI above.

These are reused from development, because they identify free provider accounts rather than this instance:
- GROQ_API_KEY and GOOGLE_GENERATIVE_AI_API_KEY. They share the free daily quotas with development. A separate Gemini key from a separate Google Cloud project, with billing off, would give the public app its own Gemini quota.
- ALPACA_API_KEY_ID and ALPACA_API_SECRET_KEY, for SIP bars and the market calendar. LIVE_INGEST is false on Render, so they never open the one live WebSocket the free plan allows.
- SEC_USER_AGENT, a name and a contact rather than a secret, for get_financial_facts.

## The day before
- [ ] The deployed service runs the latest main, and render.yaml matches its settings: LIVE_INGEST false, DEMO_MODE true, LOCAL_EMBEDDINGS false.
- [ ] The keep-alive cron pinged /health in the last hour (its log shows 200).
- [ ] `npm run smoke -- --url https://<service>.onrender.com` passes, Investigate included. That spends one research run of the day's 30.
- [ ] The research budget has room: research_budget on the public cluster shows the UTC day's count well under 30. It resets at 00:00 UTC, which is 03:00 in Israel.
- [ ] Groq and Gemini quotas are not near their daily limits (docs/SPIKE.md).
- [ ] The feed, report and run screens render on the deployed URL at 1440px and at 1279px.
- [ ] The demo item is already extracted on the public cluster, so a replay calls no model (The first replay on the public database, above).
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
- **Deployed app down or slow to wake:** switch to the local fallback. It is the same code on the development cluster, with the same seeded graph, and it additionally has filing search.
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
