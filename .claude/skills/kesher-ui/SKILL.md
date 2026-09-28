---
name: kesher-ui
description: Build or change Kesher web UI to match docs/UI.md. Use whenever you create or edit files in apps/web, including components, styles and tests.
---

1. Read docs/UI.md before writing any markup, and open the matching reference in docs/design/ for exact spacing and structure.
2. Use only theme tokens, such as bg-panel, text-text-2 and border-border. Never write a hex color in a component; the theme test fails if you do.
3. Green and red mean only up or down, and verified or removed. Anything the model decided uses the model color; anything code computed uses the code color.
4. Numbers use tabular numerals, and percentages carry a sign and a true minus.
5. Every interactive element is a button or a link with a visible label and a target of at least 44px.
6. Check the result in the Browser pane at 1440px and at 1279px before you report back.
