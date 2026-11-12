# 001: Engine core: game loop, input and two fighters moving

Status: ready
Created: 2026-11-12

## Goal
Two datamon people stand on a pixel stage facing each other, and two players can walk, crouch and jump them around with keyboard or gamepad. Under the hood a fixed-timestep, deterministic simulation drives everything, and tests prove it: the same inputs always produce the same state.

## Context
First spec of the fighting game. All interview decisions, the loop architecture rules and the rendering facts live in `docs/game-design.md`; read it first, its "Game loop architecture" section is binding for this spec. The repo has assets (`public/datamon/`) and the catalog (`src/data/datamonCatalog.js`) but no code yet. Combat comes later, so the order of operations in the step function must already have the slots combat will fill.

Revised 2026-11-12 after the round 2 interview: 640x360 internal resolution, and fighters drawn through the animation clip format in `docs/game-design.md`. Spec 002 (animation pipeline) runs in parallel and produces real clips in that format; this spec only needs placeholder clips built from the walk sheets, and its loader must accept a real `manifest.json` unchanged.

## Requirements
- R1. Project scaffold: Vite + TypeScript (strict) + Vitest, npm scripts `dev`, `build`, `test`, `typecheck`. A typed wrapper over the catalog exposes the 37 people (`kind: "datamon_person"`); the voxel skins (ids 0..5) are ignored.
- R2. Fixed-timestep loop: the sim runs at exactly 60 steps per second of real time through an accumulator, at most 5 steps per animation frame (excess time is dropped, not queued), and draws once per animation frame after stepping. The loop takes an injectable clock so it can be unit-tested. Returning to a hidden tab does not fast-forward.
- R3. Deterministic sim: `step(state, inputs)` advances one frame using only the state and the two input bitmasks. State is plain JSON-serializable data; positions and velocities are integers in subpixels (100 per px); randomness only from a seeded PRNG kept in the state. A `hashState(state)` function gives a stable hash. `src/sim` has no DOM, clock, `Math.random` or transcendental `Math` use, and imports nothing outside `src/sim` and `src/data`.
- R4. Input: keyboard and gamepad are sampled once per step into a per-player bitmask (up, down, left, right, light, heavy, special, start). Default bindings follow the table in `docs/game-design.md`, defined as one data table. The sim keeps at least 30 frames of input history per player, gives "pressed this frame" from it, resolves SOCD (left+right and up+down each become neutral), and turns left/right into forward/back relative to facing.
- R5. Movement state machine: states idle, walk-forward, walk-back, crouch, jumpsquat, airborne (neutral, forward or back jump), landing. Walking back is slower than forward. Fighters face each other and only turn around while grounded. Pushboxes keep fighters from overlapping (walking into the opponent pushes them), jumping over the opponent swaps sides, stage walls stop fighters, and fighters can never be farther apart than the screen allows.
- R6. Rendering: a 640x360 internal canvas scaled by the largest integer factor that fits the window, letterboxed, no smoothing. A placeholder stage (sky gradient, floor line). A camera that follows the midpoint between the fighters, clamped to the stage. Fighters are drawn through the animation clip format from `docs/game-design.md` (atlas frames with an anchor and hold ticks; art faces right and is mirrored around the anchor for facing left). A clip loader reads a fighter's `public/fighters/<slug>/manifest.json` when it exists; otherwise it builds placeholder clips from the walk sheet (idle = standing side frame, walk = the 4-frame side cycle; crouch and jump reuse the standing frame), downscaled once so a standing person is about 150px tall, with hard alpha edges. Which clip and frame shows comes from sim counters. Each fighter has a simple shadow on the floor.
- R7. Sandbox scene: `npm run dev` opens straight into a two-fighter sandbox. `?p1=<slug>&p2=<slug>` picks the fighters (defaults `julien-hovan` and `felicia-gorgacheva`); an unknown slug falls back to the default with a console warning. F1 toggles a debug overlay with sim frame, render FPS, steps run on the last animation frame, and each fighter's state name. `window.__game` exposes `simFrame` and `hashState()` for browser checks.

## Acceptance criteria
- [ ] A1. (R1) `npm install`, `npm run build`, `npm run typecheck` and `npm test` each exit 0. How to check: run each with `> log 2>&1; echo "EXIT=$?"`.
- [ ] A2. (R1) The catalog wrapper returns exactly 37 people, each with a portrait URL, a sheet URL and 4 frames for `left` and `right`. How to check: a Vitest test.
- [ ] A3. (R2) Loop unit tests with a fake clock: 60 deltas of 1000/60 ms run 60 steps; 120 deltas of 1000/120 ms run 60 steps; one 1000 ms delta runs exactly 5 steps and leaves the accumulator below one step. How to check: `npm test`, test names in Implementation notes.
- [ ] A4. (R2) In the browser, `window.__game.simFrame` advances by 600 ±6 over 10 seconds of wall time. How to check: read it twice through the browser tools, 10 s apart.
- [ ] A5. (R3) Determinism test: a scripted 600-frame input sequence (walking both ways, crouching, all three jumps, a jump over the opponent) run twice from the same seed gives identical `hashState` at every 60th frame. A run that JSON round-trips the state at frame 300 and continues ends on the same final hash. How to check: `npm test`.
- [ ] A6. (R3) A purity test scans `src/sim/**/*.ts` and fails on `Math.random`, `Date`, `performance`, `window`, `document`, `Math.sin|cos|tan|atan2|exp|log|pow|sqrt`, or an import from outside `src/sim` or `src/data`. How to check: `npm test`; also confirm it fails if `Math.random()` is added to a sim file, then remove it.
- [ ] A7. (R4) Input tests: left+right gives neutral; up+down gives neutral; "right" is forward when facing right and back when facing left; "pressed this frame" is true only on the first frame a button is held; history holds at least 30 frames. A gamepad-mapping test turns a fake gamepad state (d-pad, left stick past a deadzone, face buttons) into the expected bitmask. How to check: `npm test`.
- [ ] A8. (R5) Movement tests: a neutral jump leaves the ground after the jumpsquat and lands back on the floor on a fixed, asserted frame; forward walk is faster than back walk; a fighter held against a wall stays at the wall; separation never exceeds the screen limit; after every step of the A5 sequence the two pushboxes do not overlap; after jumping over the opponent, both fighters' facing flips on landing, not in the air. How to check: `npm test`.
- [ ] A9. (R6) In the browser at 1440x900 and at 800x600 the canvas's internal size is 640x360 and its CSS size is an integer multiple of that, and a screenshot shows both fighters with hard pixel edges, standing on the floor and facing each other. How to check: read the canvas attributes and computed style with the browser tools; screenshot path in Implementation notes.
- [ ] A10. (R4, R5, R6) In the browser, P1 (WASD) and P2 (arrow keys) can each walk with the walk cycle animating, crouch and jump, and walking into the opponent pushes them. How to check: drive the keys with the browser tools, take screenshots mid-walk, crouched and mid-jump.
- [ ] A11. (R7) `?p1=jewoo-lee&p2=veronica-marallag` shows those two people; `?p1=nobody` shows the default P1 and logs a warning. F1 shows and hides the overlay with all four fields. How to check: browser tools, screenshot and console messages.

## Out of scope
- Attacks, hitboxes, health, damage, K.O. (spec 002, combat core).
- Generated animation clips and the art pipeline (spec 002).
- Sparks, smears, shake, flashes (spec 004).
- Menus, character select, HUD, rounds, timer (spec 004).
- Archetypes and per-fighter stats: every fighter uses the same movement numbers here.
- CPU opponent, audio, real stage art, key rebinding UI, touch controls.

## Decisions
- Stack is Vite + TypeScript + Canvas 2D with no engine, and npm. Use the current stable versions (Vite 8, Vitest 5 and TypeScript 7 at the time of writing); check the scaffold works rather than assuming flags.
- No render interpolation: draw the latest sim state, as arcade fighters do, so every displayed frame is a real sim frame.
- Integer subpixels instead of floats, so hashing is stable and determinism doesn't depend on float behavior.
- Starting movement numbers, in pixels at 640x360 (kept in one tunable data file): floor at y=320; stage 1280 wide; screen margin 40, so max separation is 560; pushbox 46 wide; walk forward 2.7/frame, back 2.0/frame; jumpsquat 4 frames; jump launch speed 11.6/frame with gravity 0.58/frame^2 (exactly 40 airborne frames in subpixels, about 116px apex); jump horizontal speed 3.3/frame; landing 3 frames.
- Placeholder fighter scale: one global factor that maps source footY 228 to 150px, so relative heights between people are kept. Generated clips (spec 002) are already at game scale and are drawn 1:1.
- Walk sheet cells differ per person (`cellW` 99 to 130, `cellH` 240): always read them from the catalog.
- Placeholder walk cycle shows each of the 4 side frames for 8 sim frames; the standing frame is column 2 (`STANDING_WALK_FRAME`).
- `src/engine` holds the real-time loop, separate from `src/sim`.
- The hash is FNV-1a over a canonical serialization of the state (sorted keys).

## Open questions
- None.

## Tasks
- [ ] T1. Scaffold Vite + TypeScript in the repo root (keep `public/datamon/`), add Vitest, set strict TS, add scripts `dev`, `build`, `test`, `typecheck`. `index.html`, `src/main.ts`, `vite.config.ts`, `tsconfig.json`, `package.json`.
- [ ] T2. Typed catalog wrapper: `src/data/catalog.ts` (types for people and creatures, `getPeople()`, `getPerson(slug)`), with a `.d.ts` or `allowJs` for `datamonCatalog.js`. Movement numbers in `src/data/movement.ts`.
- [ ] T3. Sim foundations: `src/sim/fixed.ts` (subpixel constants and helpers), `src/sim/rng.ts` (seeded PRNG, integer-only), `src/sim/hash.ts`, `src/sim/types.ts`, `src/sim/state.ts` (`createSandboxState(seed, p1Slug, p2Slug)`).
- [ ] T4. Input: `src/input/bits.ts` (bitmask layout), `src/input/keymap.ts` (default bindings table), `src/input/keyboard.ts`, `src/input/gamepad.ts`, `src/input/sampler.ts` (devices to two bitmasks per step). Sim side: `src/sim/inputHistory.ts` (ring buffer, pressed, SOCD, facing-relative).
- [ ] T5. Sim step: `src/sim/fighter.ts` (movement state machine), `src/sim/physics.ts` (movement, gravity, pushboxes, walls, max separation, facing), `src/sim/step.ts` following the order of operations in the design doc, with named no-op slots for hit detection and hit application.
- [ ] T6. Loop: `src/engine/loop.ts` (accumulator, step cap, injectable clock, visibility handling).
- [ ] T7. Render: `src/render/screen.ts` (internal canvas, integer scaling, letterbox), `src/render/clips.ts` (clip types matching the manifest format, manifest loader, placeholder clips from a walk sheet: downscale, alpha threshold, cache), `src/render/camera.ts`, `src/render/stage.ts` (placeholder), `src/render/fighterRenderer.ts` (clip and frame from state, mirroring around the anchor, shadow), `src/render/debugOverlay.ts`. Add a `src/render/clips.test.ts` that loads a small fixture manifest.
- [ ] T8. Sandbox: `src/scenes/sandbox.ts`, wiring in `src/main.ts`, URL params, `window.__game`.
- [ ] T9. Tests: `src/engine/loop.test.ts`, `src/sim/determinism.test.ts`, `src/sim/purity.test.ts`, `src/sim/inputHistory.test.ts`, `src/input/gamepad.test.ts`, `src/sim/movement.test.ts`, `src/data/catalog.test.ts`.
- [ ] T10. Browser checks for A4, A9, A10, A11 with the browser tools; save screenshots under `specs/evidence/001/`.

## Follow-ups
The rest of the game is planned in the Roadmap section of `docs/game-design.md` (specs 002 to 009). Write each with `/spec-create` when the previous one is done; 002 (combat core) is next.

## Implementation notes
(filled by spec-tackle)

## Review
(filled by spec-review)
