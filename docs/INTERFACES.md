# Interfaces v0

Contracts between modules. T02 and T07 turn them into code. Update this file in the same commit whenever a contract changes.

## MCP tools
All tools are read only. Identity and the allowed tool list come from the run token, never from arguments.

| Tool | Input | Output | Notes |
|---|---|---|---|
| get_my_portfolio | none | holdings with weights | user resolved from the token |
| get_event | eventId | event with its extraction and source ids | |
| get_company_relationships | symbol, types? | edges with evidence | reviewed edges only |
| search_news | query, symbols?, since? | ranked news items with source ids | hybrid search |
| search_filings | symbol, query | filing chunks with source ids | RAG over FilingChunk; at most 3 chunks per call |
| get_price_reaction | symbol, eventTime | anchor, then stock, SMH and SPY moves per window, delayed flag | see below |

### get_price_reaction
Anchored to the regular session; the Alpaca market calendar defines trading days, opens and closes (weekends, holidays, early closes). SIP bars older than 15 minutes.
- anchor: kind (`headline` when the headline falls inside a regular session, `previous_close` otherwise), baseTime, basePrice, tradingDay (YYYY-MM-DD, ET).
- windows, each with pct and the bar time used, for the symbol, SMH and SPY:
  - `headline` anchor: 15m, 2h, sessionClose.
  - `previous_close` anchor: openGap, 15m after the open, 2h after the open, sessionClose.
  - A window that would end after the session close ends at the close.
- delayed: true.
| get_financial_facts | symbol, metrics | XBRL values with period and source | us-gaap filers only in the MVP |
| search_x_posts | query, since? | posts as Tier 3 signals with links | V2, not in the MVP (X level 1) |

## Run token
Minted by the api for each agent run and signed with MCP_TOKEN_SECRET.
- sub: user id
- agent: research or verifier
- tools: allowed tool names
- exp: 5 minutes

The MCP server rejects any call to a tool that the token does not list.

## REST (api)
- GET /health: `{ status: "ok" }`, HealthResponse in packages/shared
- POST /auth/login, GET /me
- GET /feed?cursor=
- POST /events/:eventId/investigate
- GET /runs/:runId
- POST /dev/replay/:sourceId (development only, not mounted in production): sourceId is an Alpaca news id, not a Source._id. Replays the recording `recordings/alpaca/<sourceId>.json` through the pipeline (pre filter, injection screen, extraction) in replay mode. Returns ReplayResponse in packages/shared, where the ids are the stored Source and MarketEvent:
  - `{ outcome: "processed", sourceId, eventId, sourceCreated, eventCreated }`: the item now has an extraction. The flags are false when the replay resumed an item stored earlier.
  - `{ outcome: "dropped", reason: "not_in_universe" }`: nothing is stored.
  - `{ outcome: "dropped", reason: "duplicate" | "update", sourceId, eventId }`: the item was already processed; nothing is extracted again. A second replay of the same item returns duplicate with the same ids.
  - 400 when sourceId is not all digits, 404 when there is no recording, 503 when a needed model key is missing (the body names it) or both model providers are rate limited. After a 503 the item is stored without an extraction and resumes on the next replay.

## Socket.IO events, server to client
- feed:item: a new FeedItem for the current user
- feed:update: a FeedItem changed (status, confidence, research state)
- run:step: a new step in the AgentRun being viewed
