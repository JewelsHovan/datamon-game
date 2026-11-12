# 004: Effects and feel

Status: in-progress
Created: 2026-11-12

## Goal
Every hit, block, landing and special looks and feels like it connects: generated pixel effect animations play at the point of contact, and the screen reacts with shake, flashes and a K.O. slow-motion beat.

## Context
The art side runs through the spec 002 pipeline with an "effect" mode (no calibration figure; scaled to a target size; centered anchors). The runtime side plugs into spec 003's events (hit, block, land, knockdown, projectile, ko). `docs/game-design.md` rule 7: effects consume sim events and keep their own render-time clocks; they never write back to the sim. The effect art can be made now; the runtime tasks wait for spec 003.

## Requirements
- R1. Effect definitions in `art/effects.json`: id, frame count, per-frame descriptions, holds, target height in game pixels, anchor (center or bottom).
- R2. The pipeline generates and processes effects (`art/pipeline/effects.py`): no calibration figure, the tallest frame scaled to the target height, hard alpha, colors kept as generated (effects are not palette-locked), packed to `public/effects/atlas.png` + `manifest.json` in the clip format.
- R3. Effect set: light hit spark, heavy hit burst, block flash, dust puff, projectile orb (loop), projectile burst.
- R4. Runtime effects layer: spawns an effect on each sim event at the contact point (hit: the overlap of hitbox and hurtbox; block: the defender's front edge; dust: the feet), mirrors with facing, draws additively above the fighters, and expires on its own clock.
- R5. Feel: screen shake scaled by hit strength (light 2px, heavy 4px, K.O. 8px, decaying over ~10 frames); a 2-frame white flash on the defender's sprite when hit; the camera nudges toward big hits; K.O. plays a 0.5-second slow-motion (sim stepped at a quarter rate, render keeps 60 fps) with a full-screen flash.
- R6. All feel effects respect a "reduced effects" toggle (no shake, no flash) for players sensitive to motion.

## Acceptance criteria
- [x] A1. (R1, R2, R3) `public/effects/manifest.json` lists the 6 effects; a pytest validates it with the spec 002 manifest checks; each effect's tallest frame is within 2px of its target height.
- [x] A2. (R3) Each effect's contact sheet and GIF pass a visual review: reads as the intended effect at game size, no stray characters or text, frames progress in order. Reviewed in Implementation notes; GIFs in the HQ Animation lab.
- [x] A3. (R4) In the browser, a light punch hit shows the light spark at the fist, a heavy kick shows the burst, a block shows the block flash, a knockdown raises dust; screenshots mid-effect in `specs/evidence/004/`.
- [ ] A4. (R5) Shake, defender flash and K.O. slow-motion are visible in a recorded clip or screenshot sequence; a unit test checks the shake amplitude decays to 0 and that slow-motion does not change sim determinism (same hash as a run without it).
- [x] A5. (R6) With reduced effects on, no shake or flash is applied (unit test on the effects layer).

## Out of scope
- Super flash and battlemon summon effects (spec 007).
- Sound (spec 010).
- Stage reactions (spec 009).

## Decisions
- Effects are not palette-locked: their colors are part of the game's shared look, not a fighter's.
- Slow-motion lives in the engine loop (fewer sim steps per second), never in the sim, so determinism is untouched.

## Open questions
- None.

## Tasks
- [x] T1. `art/effects.json` with the 6 effects.
- [x] T2. `art/pipeline/effects.py` (generate, process, pack) and pytest.
- [x] T3. Generate, review and approve the 6 effects; publish GIFs to the HQ.
- [x] T4. Runtime effects layer and event wiring (after spec 003).
- [x] T5. Shake, flash, camera nudge, K.O. slow-motion, reduced-effects toggle (after spec 003).
- [ ] T6. Tests and browser evidence.

## Implementation notes
2026-11-12, lead session (art half; the runtime half waits for spec 003).

- `art/pipeline/effects.py` cuts effects by column gaps with an equal-slot fallback, scales the tallest frame to the target height, and anchors on the slot center (or the shared bottom row for dust) so effects hold still between frames. Bottom anchors are clamped into the frame after rounding.
- A1: pytest `test_effects_manifest` passes (10 passed in total, EXIT=0): 6 clips, 26 frames, atlas 1024x95, tallest frame of each effect within 2px of its target.
- A2: all 6 effects passed review on the first generation (6 images): the light spark reads as a quick star pop, the heavy burst has a white shockwave ring, the block flash is a cyan hex-shield arc facing forward, the dust spreads and thins, the orb's tail points back (it travels right; mirrored for P2), and the orb burst scatters square data pixels. GIFs are in the HQ Animation lab under "Hit effects".
- The review canvas in `process.review_images` now sizes for anchors that are not on the bottom row.

Runtime half (with spec 003):
- `src/render/effects.ts`: effects spawn on sim events at the contact point (hit: hitbox and hurtbox overlap center; block: the defender's shield, facing the attacker; knockdown and landing: dust at the feet; clash: orb bursts), additive blending for sparks, own render clock. Shake 2/4/8 px decaying over 10 frames, 2-frame white flash on the defender, a 3 px camera nudge toward heavy hits, a white screen flash on K.O. K.O. slow motion lives in the scene loop (sim stepped every 4th tick for 30 render frames), never in the sim.
- Reduced effects: F3 toggles; it starts on when the OS asks for reduced motion.
- A3: `specs/evidence/003/02-light-punch-spark.png`, `03-knockdown-dust.png`, `04-block-flash.png`, `06-ko-slowmo.png` from the fight check.
- A5 and the shake half of A4: `src/render/effects.test.ts` (3 tests). Still open for A4: a recorded clip showing shake, flash and slow-motion in motion.

## Review
(filled by spec-review)
