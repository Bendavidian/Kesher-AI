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
| search_filings | symbol, query | filing chunks with source ids | RAG over FilingChunk |
| get_price_reaction | symbol, eventTime | stock, SMH and SPY moves per window, delayed flag | SIP bars older than 15 minutes |
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
- POST /auth/login, GET /me
- GET /feed?cursor=
- POST /events/:eventId/investigate
- GET /runs/:runId
- POST /dev/replay/:sourceId (development only)

## Socket.IO events, server to client
- feed:item: a new FeedItem for the current user
- feed:update: a FeedItem changed (status, confidence, research state)
- run:step: a new step in the AgentRun being viewed
