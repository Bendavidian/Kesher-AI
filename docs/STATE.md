# State

Updated: 28 Sep 2026, T01 done

## Where we are
T00 and T01 are done. T00's results are in docs/SPIKE.md, and its decisions (model split, pre filter, injection screen, UI) are in the SPEC.md decision log. The monorepo runs: npm workspaces apps/web, apps/api, packages/shared and packages/mcp (the spike stays outside them), TypeScript 6.0 strict (typescript-eslint does not support 7 yet), type-aware ESLint, Prettier and Vitest. `npm run dev` starts the api on localhost:3001 and the web dev server on localhost:5173, which proxies /api to the api; .claude/launch.json starts either one for the Browser pane.

The api serves GET /health, validated by HealthResponse in packages/shared. The web shell is the terminal frame from docs/UI.md: top bar, three panels (feed 360, event fluid, scores 340) and the ticker footer, stacking as feed, event, scores below 1280px. The Tailwind theme holds exactly the UI.md colors (the default palette is removed), and a test ties it to the UI.md token table and keeps hex values out of components. packages/mcp is an empty placeholder until T07.

CI (.github/workflows/ci.yml) runs typecheck, lint and test on Ubuntu and Windows on every push to main that touches code; doc only pushes skip it. The first run passed on both (about 5 billed minutes per push).

## Next
1. T02 domain model and seed. Source carries the injection screen result, and AgentRun steps carry provider and model.
2. On the Windows laptop: pull, run npm install, check Node is at least 22.12 (.nvmrc says 26), and start both servers from .claude/launch.json (it may need npm.cmd instead of npm).

Keys set in .env: SEC_USER_AGENT, ALPACA_API_KEY_ID, ALPACA_API_SECRET_KEY, FINNHUB_API_KEY, MONGODB_URI, JWT_SECRET, MCP_TOKEN_SECRET, GROQ_API_KEY, GOOGLE_GENERATIVE_AI_API_KEY. Add LIVE_INGEST (see .env.example) on each machine; false on both for now.

## Open decisions
None. The UI language is settled by docs/UI.md: English interface, with Hebrew summaries as a later option.

## Session log
Newest first. One line per session: date, machine, task, result.
- 28 Sep 2026, macOS (Mac mini), T01: monorepo scaffold, GET /health, web terminal frame with the UI.md tokens, CI green on Ubuntu and Windows; T01 done.
- 28 Sep 2026, macOS (Mac mini), T00: console numbers and billing recorded, T00 done; model split, pre filter, injection screen and desktop first decided; UI docs approved and added under docs/.
- 28 Sep 2026, macOS (Mac mini), T00: zero budget decisions committed and pushed to GitHub; all seven spike checks pass; findings A to F and the demo item pin decided and recorded; console quotas and Gemini billing confirmation still open.
- 27 Sep 2026, setup: repository created from the starter kit.
