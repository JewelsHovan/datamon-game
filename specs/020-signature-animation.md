# 020: Signature animation polish

Status: review
Created: 2026-11-18

## Goal
Make standout specials and defensive outcomes readable through movement and timing, not just particles.

## Context
Build on v2 clips and the defensive events from spec 018.

## Requirements
- R1. Give Hotfix Charge, Context Switch, and Rapid Deploy distinct anticipation, travel, and impact beats.
- R2. Differentiate Perfect Shield, Guard Break, and Throw Escape in presentation and preserve reduced-effects support.
- R3. Preserve combat data, timings, and deterministic simulation.

## Acceptance criteria
- [x] A1. (R1) Each named special's authored beats are tied to the corresponding move timeline and testable at key ticks.
- [x] A2. (R2) Each outcome has a distinct visual response with a reduced-effects-safe variant.
- [x] A3. (R3) Existing combat checks pass and no simulation timing or move balance changes.

## Out of scope
New moves, Battlemon supers, and a full roster re-animation.

## Decisions
Reuse existing sprite art with targeted pose timing and pixel-snapped presentation. Do not change gameplay to fit the art.

## Open questions
None.

## Tasks
- [x] T1. Author and wire the signature move beats.
- [x] T2. Polish shared defensive reactions and add focused tests.

## Implementation notes
- `src/render/signatureAnimation.test.ts` checks the move timelines, pixel-snapped poses, defensive cues, and reduced-effects variants against simulated combat. `./dm check` passed typecheck, tests, and build; no simulation or move data changed.
- Chrome smoke check exercised the three specials in Training; it confirmed the selected moves and live effect activity. It did not include a visual timing review of every frame.

## Review
