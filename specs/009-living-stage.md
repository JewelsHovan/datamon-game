# 009: Living stage

Status: review
Created: 2026-11-12

## Goal
The fight happens somewhere: a painted Compass office stage in the same pixel style as the fighters, with depth from parallax layers and coworkers walking past in the background who stop to watch a K.O.

## Context
Round 3 interview ("Living stage & menus"). The stage today is a gradient and a floor line (`src/render/stage.ts`); the camera follows the fighters across a 1280 px stage (`src/render/camera.ts`). Stage art goes through image generation (the effects-style pipeline: no calibration, scaled to target size) and the walkers reuse the datamon walk sheets. Menu animation (select screen, versus splash) is built in spec 005; this spec adds the stage behind the fight.

## Requirements
- R1. One stage, "Open-plan office at dusk": a far layer (city skyline at dusk through tall windows), a mid layer (desks, monitors, plants, a whiteboard with architecture boxes) with a transparent background, and a floor strip, generated and reduced to a shared stage palette at game scale. Layer widths match their parallax factors (far 0.35, mid 0.7, floor 1.0 across the 1280 px stage).
- R2. Parallax rendering from the camera; small ambient animation (monitor flicker, a ceiling light, blinking window lights) drawn in code on top of the layers.
- R3. Background walkers: 3 to 5 datamon coworkers (not the two fighters) walking across the mid layer at about 60% scale and darkened for depth, using their walk sheets, entering and leaving at random but deterministic times (render-side seeded RNG). On a K.O. they stop, face the fight and hold for the slow-motion beat.
- R4. Fighters stay readable: the stage behind them is lower contrast than the fighters (checked on screenshots), and the floor line matches the sim floor.

## Acceptance criteria
- [x] A1. (R1) Layers exist under `public/stages/office/` with a manifest; pytest checks sizes and the palette limit.
- [x] A2. (R2, R4) Browser screenshots at three camera positions show parallax (layers shift by different amounts) and readable fighters.
- [x] A3. (R3) Screenshots show walkers mid-walk and watching after a K.O.; a unit test checks the walker scheduler is deterministic for a seed.
- [x] A4. No drop below 60 fps in the existing browser check (render fps in `window.__game.info()`).

## Out of scope
- More stages and stage selection (later), stage hazards.

## Decisions
- Painted layers are generated; motion comes from code so the art stays still and crisp.

## Open questions
- None.

## Tasks
- [x] T1. Generate and process the stage layers; manifest; pytest.
- [x] T2. Parallax renderer and ambient animation.
- [x] T3. Walkers and the K.O. reaction.
- [x] T4. Evidence and HQ.

## Implementation notes
2026-11-12, lead session.

- `art/pipeline/stage.py` + `art/stages.json`: far layer (dusk skyline through tall windows, 864x360 for factor 0.35) and mid layer (desks, monitors with code, coffee station, architecture whiteboard, plants, pendant lamps, transparent, 1088x360 for factor 0.7), both reduced to 64 colors. Manifest at `public/stages/office/manifest.json`.
- `src/render/stage.ts` keeps the spec 001 `drawStage(ctx, camera)` signature and lazy-loads the stage: far layer, blinking city lights, walkers, mid layer, a dimming pass so fighters read first, and a code-drawn floor on the sim floor line. `stageReact("ko", x)` makes walkers stop and face the fight (wired into the scene at the spec 005 merge).
- `src/render/stageWalkers.ts`: pure seeded scheduler; tests in `stageWalkers.test.ts` (deterministic per seed, walkers cross and respawn, K.O. makes everyone stop and face the fight).
- Screenshot of a live training match on the stage: fighters readable over the dimmed office.

2026-11-12, lead session (T4, evidence).

- K.O. reaction: wired into the fight scene (`stageReact("ko", x)` on every `ko` event, commit f3de2d2).
- Walkers were hidden: drawn behind the mid layer, which covers 55-85% of the width at every height from 190 to 300 px (monitors, plants, drawers), a 60%-scale coworker showed only a leg in a gap. They are now drawn after the furniture (still darkened, still behind the fighters and under the dimming pass), so they read as coworkers walking past the desks. Scale and floor line unchanged.
- `window.__game.info().stage` (`stageInfo()` in `src/render/stage.ts`) reports the camera, each layer's offset and each walker's screen x and whether it is watching, so the browser check can wait for the right moments.
- Deviations for the reviewer: R1 asks for "a floor strip, generated" and "a shared stage palette"; the floor is drawn in code on the sim floor line (boards, reflection, `floorColor` from the manifest), and each layer is reduced to its own 64 colors.
- A1: `art/pipeline/tests/test_stage.py`, 6 tests (manifest lists far and mid; each layer's size matches its parallax factor, 864x360 and 1088x360; each layer within its 64-color limit; far opaque, mid cut out). `uv run --with pytest --with pillow --with numpy --with scipy pytest art/pipeline/tests -q` EXIT=0, 17 passed.
- A2: `specs/evidence/009/stage-check.mjs` (EXIT=0) screenshots the camera at the left wall, center and right wall (`02-camera-left.png`, `01-camera-center.png`, `03-camera-right.png`) with the renderer's offsets in `positions.json`: far 0/112/224, mid 0/224/448, floor 0/320/640. `specs/evidence/009/parallax.py` (EXIT=0) measures the shifts from the pictures between the left and center shots: far 112 px, mid 224 px, matching the renderer; the floor's 64 px boards make its 320 px move unmeasurable in pixels, so its offset comes from the renderer. Fighters read clearly over the dimmed office in all three.
- A3: `04-walkers-walking.png` (two walkers in view mid-stride), `05-walkers-watch-ko.png` (a K.O. in a VS match; two walkers in view stopped and facing the fight, one of them behind the fighters). The check waits until a walker is in view before the finishing kick. The scheduler's determinism is unit-tested in `src/render/stageWalkers.test.ts`.
- A4: render fps sampled every half second through both parts of the check: 74 samples, min 59.9, average 60.0 (the loop measures over half a second, so a steady 60 Hz reads 59.x to 60.x). No console errors.


## Review
(filled by spec-review)
