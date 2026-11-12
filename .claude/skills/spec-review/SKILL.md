---
name: spec-review
description: Independently verify an implemented spec against its acceptance criteria, clause by clause with evidence, then mark it done or send it back with changes requested. Use when the user says "spec-review", "review spec N", "verify spec N", or "is spec N done".
argument-hint: "[spec number or slug; default: lowest-numbered spec in review]"
---

# spec-review

Decide whether a spec is really done. Trust the code and the checks, not the Implementation notes.

## Steps

1. **Pick.** Use the spec named in the argument, or the lowest-numbered spec with `Status: review`.
2. **Read the claim.** Read the spec in full, then the diff that implemented it (`git diff`, or `git log` plus `git show` if it was committed) so you know what actually changed.
3. **Verify every acceptance criterion yourself.** Re-run each check; don't reuse the evidence spec-tackle wrote. Give each criterion one verdict:
   - **PASS**, with evidence (file:line, command plus exit code, or what you saw in the game).
   - **FAIL**, with what happened instead.
   - **UNVERIFIED**, with why it couldn't be checked.
4. **Look past the checklist.** Read the changed code for bugs, edge cases the spec names, anything listed under Out of scope that got built anyway, and changes outside the spec's files. Run the full test suite and build if the project has them.
5. **Write the Review section** in the spec:

   ```markdown
   ## Review
   Reviewed: YYYY-MM-DD
   Verdict: approved | changes-requested

   | Criterion | Verdict | Evidence |
   |---|---|---|
   | A1 | PASS | `npm test` EXIT=0; src/game/battle.test.js "applies damage" |

   Findings:
   - [must-fix] file:line: problem and the fix.
   - [nice-to-have] ...
   ```

6. **Decide.**
   - Every criterion PASS and no must-fix: `Status: done`.
   - Otherwise: `Status: in-progress`, untick the failed criteria, and add the must-fix items as new unticked Tasks so `/spec-tackle` picks them up.
   Update the row in `specs/README.md`.
7. **Report** the verdict, the criteria table in short, and the must-fix items.

## Rules

- Don't fix code in this skill. Review only; the fixes go back through spec-tackle.
- An UNVERIFIED criterion blocks approval unless the user explicitly accepts it.
- Be specific: every finding has a location and a concrete fix.
