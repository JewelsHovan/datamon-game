---
name: spec-tackle
description: Implement one spec from specs/ end to end, working its task list and proving each acceptance criterion, then hand it to review. Use when the user says "spec-tackle", "tackle spec N", "build spec N", "implement the next spec", or "work on the next spec".
argument-hint: "[spec number or slug; default: lowest-numbered ready spec]"
---

# spec-tackle

Take one spec from `ready` to `review`.

## Steps

1. **Pick.** Use the spec named in the argument. With none, take the lowest-numbered spec with `Status: ready` (or the `in-progress` one, to resume). If the spec is `draft` with Open questions, stop and ask those questions instead of guessing.
2. **Ground.** Read the whole spec, `CLAUDE.md`, and the files its Tasks name. Read linked specs if the Context points to them.
3. **Plan.** Check the Tasks still fit the code. If they don't, fix the task list in the spec first and note why under Implementation notes. Don't change Requirements or Acceptance criteria on your own; if one is wrong or impossible, stop and tell the user.
4. **Claim.** Set `Status: in-progress` and update the row in `specs/README.md`.
5. **Build, one task at a time.** Implement the task, run what proves it (tests, build, a quick run), tick `- [x]` on the task. Keep the change inside what the spec asks for; anything extra you notice goes under Implementation notes as a follow-up.
6. **Prove the criteria.** For each acceptance criterion, run its check. Write the evidence under Implementation notes: the command and its exit code, the test name, or what you saw in the running game (take a screenshot with the browser tools for visual criteria when you can). Tick a criterion only when its evidence is real.
7. **Hand off.** Set `Status: review`, update the index row, and report: tasks done, criteria proven, anything unproven and why, follow-ups. Suggest `/spec-review NNN`.

## Rules

- Judge checks by exit code (`cmd > log 2>&1; echo "EXIT=$?"`), not by grepping output.
- Don't mark the spec `done`; only spec-review does that.
- Commit only if the user asks. Then stage the spec's files by path, never `git add -A`.
- If you are interrupted, leave the ticked tasks and notes accurate so a fresh session can resume from the spec alone.
