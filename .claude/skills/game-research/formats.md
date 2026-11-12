# game-research file formats

## agenda.md

```markdown
# Research agenda

Updated: YYYY-MM-DD. Open angles rotate by last-run date. An angle can run again after 14 days if new sources are likely.

| ID | Angle | Serves | Last run | Status |
|---|---|---|---|---|
| G-01 | One sentence: the question and the games or sources to look at | 2 Combat core | 2026-11-13 | open |
```

- **Serves** is a roadmap step from `docs/game-design.md` (`<n> <name>`), `cross-cutting`, or `recurring (every 7 days)`.
- **Status** is `open` or `parked`.
- New IDs continue the sequence. Never reuse an ID.

## additions.md

```markdown
# Proposed additions

Updated: YYYY-MM-DD.

- Ranked by score: 2 x Impact + Fit + Ease, max 20.
- Statuses: proposed, covered (the design or a spec now has it), parked. Adopted and rejected are set by the user.
- Evidence: primary (a source read in full), secondary (summary or snippet), unsourced (design inference).

## Top 10

| Rank | ID | Addition | Roadmap step | Score | Evidence | Status |
|---|---|---|---|---|---|---|
| 1 | A-004 | Short title | 2 Combat core | 18 | primary | proposed |

## All additions

### A-004: Short title
- Status: proposed. First proposed 2026-11-12. Last updated 2026-11-13.
- What: what the player sees or feels, concrete enough to spec.
- Why: the evidence, each claim tagged, with its URL.
- Fits: roadmap step, and how it sits with the constraints. Mark `design change` if it bends one.
- Score: Impact 4, Fit 5, Ease 5 = 18.
- History: 2026-11-13: one line per change (new evidence, rescored, verified, covered by spec 002).
```

- Keep the All additions section in ID order.
- Additions never get deleted. Covered, parked and rejected ones stay, below the Top 10.

## daily/YYYY-MM-DD.md

```markdown
# Research YYYY-MM-DD

Next build target: step <n> <name>. Angles: G-xx <name>; G-yy <name>.

## G-xx: <angle>
### Findings
- One claim per line, tagged [primary] or [secondary], with its URL.
### Candidate additions
- A-0nn (new | updated | duplicate of A-0mm | dropped: reason): one line.

## G-yy: <angle>
...

## Verification
- A-0nn: claim checked against <URL>: confirmed | not confirmed (marked unverified).

## Changes
- additions.md: new A-0nn, A-0mm; rescored A-0kk (16 to 18); covered A-0jj by specs/002.
- agenda.md: ran G-xx, G-yy; added G-zz (<angle>, serves <step>).

## Gaps
- What this run could not find or read, so the next run can try.
```
