# State

Updated: 28 Sep 2026, T00 done

## Where we are
T00 is done. All seven spike checks pass, and the console numbers and the billing confirmation (off, Free tier) are in docs/SPIKE.md. The spike scripts stay in /spike as evidence (`cd spike && npm run spike`). No application code yet.

The console numbers set the model split: the research agent runs on Gemini gemini-3.5-flash-lite, picked once per run with Groq openai/gpt-oss-120b as the whole run fallback; extraction and the verifier run on Groq openai/gpt-oss-120b with a per call fallback to Gemini. A deterministic pre filter and a Groq prompt guard injection screen now run before extraction. The dark trading terminal UI is approved: tokens and screens in docs/UI.md, markup references in docs/design/, desktop first at 1280px. All of it is in the SPEC.md decision log, with BACKLOG.md T01, T04, T06, T08, T09, T14 and T16 updated to match.

## Next
1. T01 monorepo scaffold, now including the Tailwind tokens from docs/UI.md and the terminal frame (top bar, three panels, ticker footer). The spike stays outside the workspaces.
2. T02 domain model and seed. Source carries the injection screen result, and AgentRun steps carry provider and model.

Keys set in .env: SEC_USER_AGENT, ALPACA_API_KEY_ID, ALPACA_API_SECRET_KEY, FINNHUB_API_KEY, MONGODB_URI, JWT_SECRET, MCP_TOKEN_SECRET, GROQ_API_KEY, GOOGLE_GENERATIVE_AI_API_KEY. Add LIVE_INGEST (see .env.example) on each machine; false on both for now.

## Open decisions
None. The UI language is settled by docs/UI.md: English interface, with Hebrew summaries as a later option.

## Session log
Newest first. One line per session: date, machine, task, result.
- 28 Sep 2026, macOS (Mac mini), T00: console numbers and billing recorded, T00 done; model split, pre filter, injection screen and desktop first decided; UI docs approved and added under docs/.
- 28 Sep 2026, macOS (Mac mini), T00: zero budget decisions committed and pushed to GitHub; all seven spike checks pass; findings A to F and the demo item pin decided and recorded; console quotas and Gemini billing confirmation still open.
- 27 Sep 2026, setup: repository created from the starter kit.
