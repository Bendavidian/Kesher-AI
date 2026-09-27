---
name: kickoff
description: Start work on a Kesher backlog task. Use at the beginning of every coding session.
argument-hint: "[task id, for example T03]"
disable-model-invocation: true
---

Start task $ARGUMENTS.

1. Run git pull and report anything unexpected, such as conflicts or uncommitted changes.
2. Read docs/STATE.md, then the task entry in docs/BACKLOG.md, then the SPEC.md and INTERFACES.md sections it touches. If no task id was given, take the task under "Next" in STATE.md.
3. Restate the task in three lines: goal, what is out of scope, acceptance criteria.
4. List any conflict with SPEC.md or any missing prerequisite, such as keys or unfinished earlier tasks. If one exists, stop there.
5. Propose a plan: files to create or change, tests to write first, and how each acceptance criterion will be proven. Wait for approval before editing.
6. Once the plan is approved, mark the task [~] in docs/BACKLOG.md.
