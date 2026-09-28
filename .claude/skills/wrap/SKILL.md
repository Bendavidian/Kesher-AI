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
5. Show me the docs diff, then commit on the task branch with a message that starts with the task id.
6. Push the task branch and open a PR to main with gh pr create, titled with the task id (for example "T04: thin extraction"). If a PR for the branch already exists, push to it and report its URL. Never push to main: the user merges the PR with Rebase and merge after CI passes.
