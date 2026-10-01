# Kesher AI: UI specification

Approved design, 28 Sep 2026. Reference markup for each screen is in docs/design/. Those files come from the design canvas and need its runtime, so read them for layout and exact values; they do not run on their own.

## Direction
A dark trading terminal: dense panels on a near black background. Orange marks the user and primary actions. Green and red appear only for up and down, or for verified and removed. English interface. No buy or sell controls and no ratings, per principle 8.

## Tokens
Define these once in the Tailwind theme. Components never hardcode hex values.

| Token | Hex | Use |
|---|---|---|
| bg | #0B0E13 | app background |
| panel | #12161D | panels, top bar, ticker |
| inset | #0F131A | inner blocks, inputs, code |
| raised | #1A2029 | selected rows, tiles |
| border | #242B36 | panel borders |
| divider | #1E242E | row dividers |
| border-strong | #3A4350 | secondary buttons, dashed empty states |
| text | #E7EBF0 | primary text |
| text-2 | #AAB3C0 | secondary text |
| text-3 | #7D8797 | meta text, column headers |
| you | #FF7A33 | the user, active tab, primary button, relevance |
| you-tint | #2A1A10 | active tab and persona pill background |
| you-border | #5A3016 | active tab border |
| on-you | #1A0D05 | text on orange |
| up | #27C47A | price up, supported, completed |
| up-tint | #0F2A1E | supported chip background |
| down | #F2555A | price down, removed |
| down-tint | #2E1416 | removed chip and block background |
| supplier | #4F9CFF | supplier lines, tool calls, Tier 1 |
| supplier-tint | #102239 | Tier 1 and tool chips |
| supplier-light | #8EBBFF | tool names, JSON keys |
| competitor | #A77BFF | competitor lines |
| model | #F5B83D | anything the model decided: importance, inference, model steps |
| model-tint | #2E2410 | model chips |
| code | #2DD4BF | anything code computed: relevance and confidence tags, code steps, cost |
| code-tint | #0E2A27 | code chips |

## Type and shape
- Overpass 400, 600, 700 and 800 for the interface. Overpass Mono for code, ids and tool names.
- Tabular numerals everywhere numbers appear.
- Sizes: event headline 24/800, panel title 15/800, section title 13/800, body 13 to 14, meta 11 to 12.
- Radius: panels 10, buttons 8, chips 5 to 6.
- Desktop first. The three panel layout targets screens 1280px and wider. Below that, the panels stack in one column in the order feed, event, scores.
- 12px gaps between panels. Top bar 56px, ticker footer 34px. Touch targets at least 44px.
- Percentages always carry a sign and a true minus (+1.25%, −1.16%), in up or down color.

## Brand mark
- The Route mark: a line from a company, the ring, to the user, the orange dot. apps/web/src/brand/mark.ts holds its geometry in a 64 by 64 viewBox.
- Colors are tokens: the line supplier, the ring bg with a text stroke, the dot you. The top bar draws the mark at 24px with these as classes.
- `npm run brand` writes the favicon (the mark on a bg rounded square), favicon.ico, the touch icon and the 1200 by 630 link preview image (the mark, "Kesher AI" in Overpass 800 and one line in text-2) to apps/web/public.

## Feed screen
- **Top bar:** logo, tabs (Feed, Agent runs), search, replay status with a pulsing orange dot and the event time in ET, persona switcher. The switcher has a fourth option, Your portfolio (T24), which opens the guest picker; the Replay control is hidden for a guest.
- **Guest picker (T24):** a dialog over the feed, panel style, titled Your portfolio. The 17 universe companies in four sector groups, each a 44px toggle with the ticker in mono and the short name; the picked ones in the you tint with an orange border. At most 6: once 6 are picked the rest are disabled. A count ("3 of 6 picked"), Cancel (secondary) and Show my feed, or Update my feed for a guest (primary orange). One meta line says the guest portfolio is deleted after 24 hours and Investigate runs once a day for it; an api error shows as one neutral line. The feed header of a guest repeats that line.
- **Three panels:** feed list 360px, event detail fluid, scores and evidence 340px.
- **Feed list:** rows with time label, relevance pill (High filled orange, Medium outlined, None gray), headline, and a mini connection path.
- **Event detail:**
  - Source row: provider, tier chip, time in ET, source id.
  - Headline.
  - Extraction chips in model color, labeled as extracted by the model.
  - The connection path.
  - Market table with the anchor explained in one line.
  - Open gap bars.
- **Scores panel:** relevance (by code, orange value), importance (by the model, amber), confidence (by code, teal), and one line on which scores change per investor.
- **Evidence:** the verbatim quote, the filing, a tier chip and a reviewed mark.
- **Actions:** Investigate this event (primary orange) and View agent run (secondary).
- **Ticker footer:** the replayed session's closing moves, the api status, and the data delay. Next to the api status, one line in text-3 on live ingestion (GET /ingest/status, read at sign in and every minute): "Live ingest off" with the last live item in ET where the api does not ingest, or "Live", the stream state (connected, connecting, reconnecting, stream stopped), the last item in ET, the queue length and today's extractions of the cap. The line is the summary of a details element, a 44px target that overlaps the 34px footer's edges; it opens upward a panel, "Live ingestion today", with the extractions, the queue, the EDGAR poller and each of today's counters by name, values in code color, since code counted them.

## Connection path
The signature component.
- Stations are 40px rings with an 8px border in the color of the line reaching them. You is an orange ring with a filled center.
- Lines are 8px: supplier blue, competitor violet, holdings orange. Line labels sit above, station labels below.
- No path renders as a gray dashed line with a gray terminal.
- Motion: stations pop in sequence, lines grow left to right, and You pulses twice on arrival. It replays when the persona changes. All motion is off under prefers-reduced-motion.

## Research report screen
- **Main panel:**
  - Breadcrumb and title.
  - Chips for mode, tool calls, supported count and removed count.
  - A segmented bar with one green segment per supported claim and one red per removed claim.
  - A legend for claim types.
- **Claims table:** number, type chip (Fact supplier blue, Metric code teal, Inference model amber), claim with its evidence line, status.
- **After the table:** neutral lines in text-3 for claims not shown (not verified, or hidden with a claim they build on) and for each claim code writes in every report but left out of this one: "The price reaction wasn't available yet, so no price metric is shown", "The market data couldn't be read, so no price metric is shown", "The filing quote for a link on your path couldn't be read, so it is not shown". Never red: nothing was removed. Then open questions, then the removed claim block in down tint with a link to the check in the agent run.
- **Side panel:** your connection (mini path and relevance), then sources with tier chips and ids.

## Agent run screen
- **Left panel:**
  - Breadcrumb, title and status chips.
  - A compact Recent runs selector at the right of the breadcrumb row: the user's runs, newest first, each with its time in ET, event and mode, and a status chip; choosing one opens that run. It lets the demo show a failed run next to a successful one without another screen.
  - Summary tiles: tool calls, tokens against the run budget, model, cost.
  - A legend for step kinds.
  - The step timeline: a vertical line colored by step kind (code teal, tool blue, model amber, a check that removed a claim red), with duration and tokens per step. The selected step is highlighted.
- **Right panel:** the selected step's tool name, input and output JSON (keys supplier-light, strings code, numbers model), and an access block (user from sign in, allowed tools as chips, writes, expiry).
- **Footer:** provider limits and the token budget per run.

## Copy rules
- Never "caused". Price moves are shown next to benchmarks as timing only.
- No buy or sell language anywhere.
- The persona switcher is a demo control over seeded users, not authentication. Your portfolio is a temporary guest, never an account: no sign up, no password.
