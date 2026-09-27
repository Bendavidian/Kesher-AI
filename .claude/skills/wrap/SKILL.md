---
name: wrap
description: Close a Kesher work session so the next session, on either machine, starts with full context.
disable-model-invocation: true
---

Close the session.

1. Run npm run typecheck and npm run test. Report failures plainly. Skip this step only if the scripts do not exist yet (before T01).
2. Update docs/STATE.md: set Updated, rewrite "Where we are" and "Next", and add one session log line with the date, the machine (detect macOS or Windows), the task and the result.
3. In docs/BACKLOG.md, mark finished tasks [x] and add any new items discovered during the session.
4. If a design decision changed, append it to the decision log in docs/SPEC.md.
5. Show me the docs diff, then commit with a message that starts with the task id, and push.
