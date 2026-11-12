---
name: spec-create
description: Turn an idea into a numbered spec file in specs/ with testable acceptance criteria and a task list. Use when the user says "spec-create", "spec this", "write a spec for X", "new spec", or describes a feature to build next.
argument-hint: "<idea or feature in a sentence>"
---

# spec-create

Write one spec in `specs/` that another session could implement without asking questions.

## Steps

1. **Ground.** Read `CLAUDE.md`, `specs/README.md` and the specs that already exist (skim titles and statuses). Look at the code the idea touches. Check `src/data/datamonCatalog.js` and `public/datamon/` when the idea involves characters or creatures.
2. **Clarify only what you can't decide.** If scope, a player-facing rule, or a trade-off is genuinely the user's call, ask in one batch (at most 3 questions). Otherwise pick sensible defaults and record them under Decisions.
3. **Size it.** One spec is something one session can build and verify, roughly a day of work or less. If the idea is bigger, propose a split into several specs, write the first one, and list the rest under Follow-ups.
4. **Number it.** Next free number, zero-padded: `specs/NNN-short-slug.md` (`001-core-loop.md`).
5. **Write it** from the template below. Every acceptance criterion must be checkable: a command, a test, or a concrete thing to see in the running game. No "works well", "is fun", "is fast" without a measure.
6. **Index it.** Add a row to the table in `specs/README.md`, and update the project HQ if `CLAUDE.md` names one (apply any pending HQ decisions before writing the spec, too).
7. **Report** the path, the criteria count, and any decisions you made for the user, in a few lines.

Set `Status: ready` when nothing is left open. If Open questions remain, set `Status: draft` and say so.

## Template

```markdown
# NNN: Title

Status: draft | ready | in-progress | review | done
Created: YYYY-MM-DD

## Goal
One or two sentences: what the player (or developer) gets when this is done.

## Context
Why now, what exists already, links to related specs.

## Requirements
- R1. ...
- R2. ...

## Acceptance criteria
- [ ] A1. (R1) Concrete, checkable outcome. How to check: ...
- [ ] A2. (R2) ...

## Out of scope
- Things a reader might assume are included but are not.

## Decisions
- Defaults chosen while writing, with a one-line reason.

## Open questions
- None, or questions that block `ready`.

## Tasks
- [ ] T1. Small, ordered implementation steps. Name the files.
- [ ] T2. ...

## Implementation notes
(filled by spec-tackle)

## Review
(filled by spec-review)
```

## Rules

- Write about behaviour and outcomes, not a code dump. Name files and modules; leave line-level code to spec-tackle.
- Each acceptance criterion traces to a requirement (`(R1)`), and each requirement has at least one criterion.
- Don't edit source code in this skill.
