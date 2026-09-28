---
name: kickoff
description: Start work on a Kesher backlog task. Use at the beginning of every coding session.
argument-hint: "[task id, for example T03]"
disable-model-invocation: true
---

Start task $ARGUMENTS.

1. Run git pull and report anything unexpected, such as conflicts or uncommitted changes.
2. One branch per task. If the session is on main, create a branch named task/<task id> (for example task/T04) and work there. A worktree session already has its own branch; keep it. Never commit to main.
3. Read docs/STATE.md, then the task entry in docs/BACKLOG.md, then the SPEC.md and INTERFACES.md sections it touches. If no task id was given, take the task under "Next" in STATE.md.
4. Restate the task in three lines: goal, what is out of scope, acceptance criteria.
5. List any conflict with SPEC.md or any missing prerequisite, such as keys or unfinished earlier tasks. If one exists, stop there.
6. Propose a plan: files to create or change, tests to write first, and how each acceptance criterion will be proven. Wait for approval before editing.
7. Once the plan is approved, mark the task [~] in docs/BACKLOG.md.
