# 019: Office Cup

Status: review
Created: 2026-11-18

## Goal
Play a four-entrant local tournament with friends, CPUs, or both.

## Context
Reuse the versus-to-results flow and CPU controllers from specs 005 and 008. This is a local mode, not an arcade ladder.

## Requirements
- R1. Add a title menu entry, four independently configurable Human/CPU slots, a fighter or random pick per slot, and a shared CPU difficulty.
- R2. Show both semifinals and the final, distinguish pending/won slots, and advance the actual match winner. Use normal best-of-three matches, including watchable CPU-vs-CPU bouts.
- R3. Show the champion and let players run another cup or return to the title. Pausing, restarting the current bout, and exiting must not award a win.

## Acceptance criteria
- [x] A1. (R1) From the title, configure four slots with keyboard/menu inputs and start with selected fighters or resolved playable random picks.
- [x] A2. (R2) Tests cover CPU in either seat or both and verify advancement through the two semifinals and final.
- [x] A3. (R3) Tests verify restart preserves the bracket and the completed cup offers a fresh run or exit.

## Out of scope
Online play, persistence, custom entrant names, and brackets larger than four slots.

## Decisions
Entrant numbers carry through the bracket, versus, and results screens so mirror picks remain distinguishable. Two humans use the indicated seats; a lone human can use either control set. Back on the bracket selects Return to Title without leaving, and New Cup pre-fills the last lineup.

## Open questions
None.

## Tasks
- [x] T1. Implement bracket state, setup, and bracket canvas scenes.
- [x] T2. Wire CPU seats, results, and pause flow.
- [x] T3. Test setup, advancement, and exit paths.

## Implementation notes
- `./dm check`: typecheck, tests, and build passed. `src/scenes/flow.test.ts` drives menu setup, all three CPU seat combinations, restart and back-to-bracket without advancement, both semifinals, the final, and the new-cup path.
- Chrome smoke tested title → setup → bracket → live semifinal with both sprite manifests loaded, including a CPU-vs-CPU bout.
- Review follow-up: regression coverage confirms seat-1 input reaches a lone human in seat 2, CPU-only pause guide accepts Kick, repeated Back does not exit the bracket, and the rematch setup retains entrants and difficulty.

## Review
