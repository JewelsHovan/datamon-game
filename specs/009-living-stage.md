# 009: Living stage

Status: in-progress
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
- [ ] A1. (R1) Layers exist under `public/stages/office/` with a manifest; pytest checks sizes and the palette limit.
- [ ] A2. (R2, R4) Browser screenshots at three camera positions show parallax (layers shift by different amounts) and readable fighters.
- [ ] A3. (R3) Screenshots show walkers mid-walk and watching after a K.O.; a unit test checks the walker scheduler is deterministic for a seed.
- [ ] A4. No drop below 60 fps in the existing browser check (render fps in `window.__game.info()`).

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
- [ ] T4. Evidence and HQ.

## Implementation notes
2026-11-12, lead session.

- `art/pipeline/stage.py` + `art/stages.json`: far layer (dusk skyline through tall windows, 864x360 for factor 0.35) and mid layer (desks, monitors with code, coffee station, architecture whiteboard, plants, pendant lamps, transparent, 1088x360 for factor 0.7), both reduced to 64 colors. Manifest at `public/stages/office/manifest.json`.
- `src/render/stage.ts` keeps the spec 001 `drawStage(ctx, camera)` signature and lazy-loads the stage: far layer, blinking city lights, walkers, mid layer, a dimming pass so fighters read first, and a code-drawn floor on the sim floor line. `stageReact("ko", x)` makes walkers stop and face the fight (wired into the scene at the spec 005 merge).
- `src/render/stageWalkers.ts`: pure seeded scheduler; tests in `stageWalkers.test.ts` (deterministic per seed, walkers cross and respawn, K.O. makes everyone stop and face the fight).
- Screenshot of a live training match on the stage: fighters readable over the dimmed office.
- Open: A2 screenshots at three camera positions, A3 walker screenshots, A4 fps check; K.O. reaction wiring.

## Review
(filled by spec-review)
