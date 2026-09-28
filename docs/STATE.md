# State

Updated: 28 Sep 2026, T00 wrap

## Where we are
T00 spike ran on the Mac mini: all seven checks pass (SEC, Finnhub, Alpaca including the market calendar, Groq, Gemini, embeddings, Atlas). Results and evidence are in docs/SPIKE.md; the scripts stay in /spike as evidence (`cd spike && npm run spike`). The six spike findings (A to F) and the pinned demo item (DEMO_SOURCE_ID=38062166) are decided and recorded in the SPEC.md decision log, with SPEC.md, INTERFACES.md and BACKLOG.md updated to match. No application code yet.

T00 stays [~]: the console numbers in docs/SPIKE.md are still blank (Groq daily quota, Gemini Flash-Lite and gemini-embedding-2 free tier limits), and billing being off on the Gemini project is not yet confirmed.

## Next
1. Fill the console numbers and the billing confirmation in docs/SPIKE.md, decide the research model (see Open decisions), then mark T00 [x].
2. T01 monorepo scaffold. The spike stays outside the workspaces.

Keys set in .env: SEC_USER_AGENT, ALPACA_API_KEY_ID, ALPACA_API_SECRET_KEY, FINNHUB_API_KEY, MONGODB_URI, JWT_SECRET, MCP_TOKEN_SECRET, GROQ_API_KEY, GOOGLE_GENERATIVE_AI_API_KEY. Add LIVE_INGEST (see .env.example) on each machine; false on both for now.

## Open decisions
- Research model on Groq, and whether extraction moves to a smaller Groq model. Decide once the console quotas are in docs/SPIKE.md (T00 finding E).
- UI language. Default: English interface, Hebrew summaries as a later option.

## Session log
Newest first. One line per session: date, machine, task, result.
- 28 Sep 2026, macOS (Mac mini), T00: zero budget decisions committed and pushed to GitHub; all seven spike checks pass; findings A to F and the demo item pin decided and recorded; console quotas and Gemini billing confirmation still open.
- 27 Sep 2026, setup: repository created from the starter kit.
