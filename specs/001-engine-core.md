# 001: Engine core: game loop, input and two fighters moving

Status: review
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
- [x] A1. (R1) `npm install`, `npm run build`, `npm run typecheck` and `npm test` each exit 0. How to check: run each with `> log 2>&1; echo "EXIT=$?"`.
- [x] A2. (R1) The catalog wrapper returns exactly 37 people, each with a portrait URL, a sheet URL and 4 frames for `left` and `right`. How to check: a Vitest test.
- [x] A3. (R2) Loop unit tests with a fake clock: 60 deltas of 1000/60 ms run 60 steps; 120 deltas of 1000/120 ms run 60 steps; one 1000 ms delta runs exactly 5 steps and leaves the accumulator below one step. How to check: `npm test`, test names in Implementation notes.
- [x] A4. (R2) In the browser, `window.__game.simFrame` advances by 600 ±6 over 10 seconds of wall time. How to check: read it twice through the browser tools, 10 s apart.
- [x] A5. (R3) Determinism test: a scripted 600-frame input sequence (walking both ways, crouching, all three jumps, a jump over the opponent) run twice from the same seed gives identical `hashState` at every 60th frame. A run that JSON round-trips the state at frame 300 and continues ends on the same final hash. How to check: `npm test`.
- [x] A6. (R3) A purity test scans `src/sim/**/*.ts` and fails on `Math.random`, `Date`, `performance`, `window`, `document`, `Math.sin|cos|tan|atan2|exp|log|pow|sqrt`, or an import from outside `src/sim` or `src/data`. How to check: `npm test`; also confirm it fails if `Math.random()` is added to a sim file, then remove it.
- [x] A7. (R4) Input tests: left+right gives neutral; up+down gives neutral; "right" is forward when facing right and back when facing left; "pressed this frame" is true only on the first frame a button is held; history holds at least 30 frames. A gamepad-mapping test turns a fake gamepad state (d-pad, left stick past a deadzone, face buttons) into the expected bitmask. How to check: `npm test`.
- [x] A8. (R5) Movement tests: a neutral jump leaves the ground after the jumpsquat and lands back on the floor on a fixed, asserted frame; forward walk is faster than back walk; a fighter held against a wall stays at the wall; separation never exceeds the screen limit; after every step of the A5 sequence the two pushboxes do not overlap; after jumping over the opponent, both fighters' facing flips on landing, not in the air. How to check: `npm test`.
- [x] A9. (R6) In the browser at 1440x900 and at 800x600 the canvas's internal size is 640x360 and its CSS size is an integer multiple of that, and a screenshot shows both fighters with hard pixel edges, standing on the floor and facing each other. How to check: read the canvas attributes and computed style with the browser tools; screenshot path in Implementation notes.
- [x] A10. (R4, R5, R6) In the browser, P1 (WASD) and P2 (arrow keys) can each walk with the walk cycle animating, crouch and jump, and walking into the opponent pushes them. How to check: drive the keys with the browser tools, take screenshots mid-walk, crouched and mid-jump.
- [x] A11. (R7) `?p1=jewoo-lee&p2=veronica-marallag` shows those two people; `?p1=nobody` shows the default P1 and logs a warning. F1 shows and hides the overlay with all four fields. How to check: browser tools, screenshot and console messages.

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
- [x] T1. Scaffold Vite + TypeScript in the repo root (keep `public/datamon/`), add Vitest, set strict TS, add scripts `dev`, `build`, `test`, `typecheck`. `index.html`, `src/main.ts`, `vite.config.ts`, `tsconfig.json`, `package.json`.
- [x] T2. Typed catalog wrapper: `src/data/catalog.ts` (types for people and creatures, `getPeople()`, `getPerson(slug)`), with a `.d.ts` or `allowJs` for `datamonCatalog.js`. Movement numbers in `src/data/movement.ts`.
- [x] T3. Sim foundations: `src/sim/fixed.ts` (subpixel constants and helpers), `src/sim/rng.ts` (seeded PRNG, integer-only), `src/sim/hash.ts`, `src/sim/types.ts`, `src/sim/state.ts` (`createSandboxState(seed, p1Slug, p2Slug)`).
- [x] T4. Input: `src/input/bits.ts` (bitmask layout), `src/input/keymap.ts` (default bindings table), `src/input/keyboard.ts`, `src/input/gamepad.ts`, `src/input/sampler.ts` (devices to two bitmasks per step). Sim side: `src/sim/inputHistory.ts` (ring buffer, pressed, SOCD, facing-relative).
- [x] T5. Sim step: `src/sim/fighter.ts` (movement state machine), `src/sim/physics.ts` (movement, gravity, pushboxes, walls, max separation, facing), `src/sim/step.ts` following the order of operations in the design doc, with named no-op slots for hit detection and hit application.
- [x] T6. Loop: `src/engine/loop.ts` (accumulator, step cap, injectable clock, visibility handling).
- [x] T7. Render: `src/render/screen.ts` (internal canvas, integer scaling, letterbox), `src/render/clips.ts` (clip types matching the manifest format, manifest loader, placeholder clips from a walk sheet: downscale, alpha threshold, cache), `src/render/camera.ts`, `src/render/stage.ts` (placeholder), `src/render/fighterRenderer.ts` (clip and frame from state, mirroring around the anchor, shadow), `src/render/debugOverlay.ts`. Add a `src/render/clips.test.ts` that loads a small fixture manifest.
- [x] T8. Sandbox: `src/scenes/sandbox.ts`, wiring in `src/main.ts`, URL params, `window.__game`.
- [x] T9. Tests: `src/engine/loop.test.ts`, `src/sim/determinism.test.ts`, `src/sim/purity.test.ts`, `src/sim/inputHistory.test.ts`, `src/input/gamepad.test.ts`, `src/sim/movement.test.ts`, `src/data/catalog.test.ts`.
- [x] T10. Browser checks for A4, A9, A10, A11 with the browser tools; save screenshots under `specs/evidence/001/`.

## Follow-ups
The rest of the game is planned in the Roadmap section of `docs/game-design.md` (specs 002 to 009). Write each with `/spec-create` when the previous one is done; 002 (combat core) is next.

## Implementation notes

### Changes to the task list
- T4: the bitmask layout lives in `src/sim/inputBits.ts`, and `src/input/bits.ts` re-exports it. The sim may only import from `src/sim` and `src/data`, and `inputHistory.ts` needs the bit values.
- T2: `src/data/datamonCatalog.d.ts` types the generated JS (no `allowJs`).
- T9: the A5 script is shared as `src/sim/testing/sandboxScript.ts` (pure; the purity test scans it). Extra small tests: `src/render/screen.test.ts` (fit and camera), `src/render/fighterRenderer.test.ts` (clip choice, reverse walk, mirroring around the anchor), `src/scenes/sandbox.test.ts` (URL params). Fixture: `src/render/fixtures/test-fighter.manifest.json`.
- T10: the browser checks run from `specs/evidence/001/browser-check.mjs`: a private headless Chrome driven over the DevTools Protocol with Node's built-in WebSocket and no extra dependencies, so the shared MCP browser stays free. Rerun: start `npx vite --port 5199 --strictPort`, then `node specs/evidence/001/browser-check.mjs http://127.0.0.1:5199/ specs/evidence/001`. It exits 0 only when every check passes and writes `results.json`.

### Choices where the spec was silent
- Jump integration: `y += vy + g/2; vy += g` (g = 58 is even). This gives exactly 40 airborne frames and a 116 px apex. With up pressed on frame N, the jumpsquat runs N..N+3, the fighter is airborne from N+4, and it touches down (state `landing`, y = floor) on N+43. Landing runs N+43..N+45, and the fighter can act again on N+46.
- Pushbox heights (the spec gives only the 46 px width): 80 px standing, 56 px crouching, 64 px airborne, measured from the feet. Boxes collide only when they overlap on both axes, and the push is resolved horizontally, half to each fighter. A fighter against a wall does not move, so the other one takes the whole push. On an exact tie, the second fighter goes the way the first is facing.
- Screen limit: each fighter is clamped to within 280 px of the previous frame's midpoint, which acts like the screen edges. The stage walls keep x within 40..1240 px (40 px margin). Order: movement, screen limit, walls, pushboxes.
- Facing updates only while both fighters are on the ground. That is what makes "both flip on landing" in A8 hold for the grounded opponent too.
- Jump direction is latched when the jumpsquat starts; a direction held during the squat overrides it. Holding up jumps again after landing. SOCD is resolved when the input is recorded. The history holds 32 frames.
- Loop: there is a 1e-6 ms float slack. When the 5-step cap is hit, the remaining time is dropped entirely (the accumulator goes to 0). While the tab is hidden nothing steps, and the first frame after it returns starts from a fresh timestamp. Render FPS is measured over 500 ms windows.
- Keyboard uses `KeyboardEvent.code`, and a tap shorter than one step is latched into the next sample. Start is Enter for P1 and NumpadEnter for P2, because the design table has no per-player start key. Gamepads use the W3C standard mapping: d-pad 12..15, left stick with a 0.5 deadzone, button 0 light, 1 heavy, 2 special, 9 start. The first connected pad is P1 and the second is P2, each OR'ed with the keyboard.
- Clip per state: idle uses `idle`; walk_forward uses `walk`; walk_back uses `walk` in reverse; crouch uses `crouch`; jumpsquat and landing show `crouch` frame 0; airborne uses `jump`. A missing clip falls back to `idle`, so a partial real manifest still draws. Placeholder anchors are at feet center (`bodyX`, `footY` scaled by 150/228), while real clips use the back foot.
- Manifest loading: the Vite dev server answers a missing `manifest.json` with `index.html` (200, text/html; checked with curl). The loader therefore sends `Accept: application/json` and requires a JSON content type. An invalid manifest logs a warning and falls back to placeholders. Unknown extra fields are ignored, and `facing: "left"` is supported.
- Purity test: it skips `*.test.ts`, which import vitest and node and hold the banned words as test data. It strips comments before scanning and bans a superset of the list in A6 (also `navigator`, `globalThis`, timers, `crypto` and the other transcendental `Math` functions).
- TypeScript 7.0.2 (native): `tsc --noEmit -p tsconfig.json` works. Proof: an injected type error made it exit 1. TS 7 no longer auto-includes `@types`, so `types: ["node", "vite/client"]` is set explicitly. Versions: vite 8.3.8, vitest 5.1.0, typescript 7.0.2, Node 22.20.
- Extras: `?seed=<int>` URL param. `window.__game` also has `snapshot()` (a JSON copy of the state) and `info()` (clip sources and loop stats).

### Evidence
- A1: `npm install` EXIT=0, `npm run build` EXIT=0, `npm run typecheck` EXIT=0, `npm test` EXIT=0 (11 files, 102 tests).
- A2: `src/data/catalog.test.ts`, the "catalog wrapper (A2)" tests: exactly 37 people, all `datamon_person`, none with id 0..5; each has a portrait URL, a sheet URL and 4 left + 4 right frames; the files exist in `public/`.
- A3: `src/engine/loop.test.ts`, "fixed-step loop (A3)": "60 deltas of 1000/60 ms run 60 steps", "120 deltas of 1000/120 ms run 60 steps", "one 1000 ms delta runs exactly 5 steps and leaves the accumulator below one step". Also tested: draws once per frame, uneven frame times, hidden tab, FPS and stop.
- A4: `simFrame` went 71 → 670 (599 frames) over 10002 ms of wall time in headless Chrome (an earlier run gave 600 over 10002 ms). See `specs/evidence/001/results.json`.
- A5: `src/sim/determinism.test.ts`, "determinism (A5)". The script is 600 frames; it visits all 7 states and all 3 jump directions and swaps sides at least once. Two runs match at all 10 checkpoints (every 60th frame). A JSON round trip at frame 300 ends on the same final hash.
- A6: `src/sim/purity.test.ts` checks every sim source and the checker itself. Manual check: appending `export const purityProbe = Math.random();` to `src/sim/physics.ts` made `npx vitest run src/sim/purity.test.ts` exit 1 ("uses Math.random"). After removing the line it exits 0.
- A7: `src/sim/inputHistory.test.ts` ("input history (A7)") and `src/input/gamepad.test.ts` ("gamepad mapping (A7)": d-pad, stick past and inside the deadzone, face buttons, combined).
- A8: `src/sim/movement.test.ts`, "movement (A8)". With up pressed on frame 1, the fighter is airborne on frame 5 and touches down on frame 44. Walking: 30 frames forward is 81 px, 30 frames back is 60 px. Wall: x stays at 40 px and 1240 px. Separation stays ≤ 560 px with both walking or jumping back. There is no pushbox overlap on any of the 600 frames. Jump-over: facing is unchanged on every jumpsquat and airborne step and flipped for both on the touchdown step.
- A9: 1440x900 gives canvas 640x360 at CSS 1280x720 (2x); 800x600 gives 640x360 at CSS 640x360 (1x). `image-rendering: pixelated`, both fighters at y = floor facing each other. Screenshots: `specs/evidence/001/a9-1440x900.png` and `a9-800x600.png`. Hard edges: in the 1440x900 shot, all 230,400 2x2 blocks inside the canvas are single-colored (`uv run --with pillow`), so there is no smoothing.
- A10: `specs/evidence/001/a10-p1-walk-1.png`, `a10-p1-walk-2.png` (walk frames 2 then 3), `a10-p1-crouch.png`, `a10-p1-jump.png`, `a10-p2-walk.png` (walk frames 2 then 3), `a10-p2-crouch.png`, `a10-p2-jump.png`, `a10-p1-pushes-p2.png`. Holding D for 3 s pushes P2 from x 66705 to 91005 subpixels, and the gap stays exactly 46 px (4600). States are read from `window.__game.snapshot()` in `results.json`. The placeholder crouch reuses the standing frame (per Decisions), so crouch shows in the overlay text, not the pose.
- A11: `specs/evidence/001/a11-jewoo-vs-veronica.png` (slugs `jewoo-lee` and `veronica-marallag`). `a11-unknown-p1.png` shows P1 `julien-hovan` with the console warning `Unknown fighter "nobody" for p1; using julien-hovan.` `a11-overlay-on.png` shows the overlay with sim frame, render fps, steps/frame and the P1/P2 states; `a11-overlay-off.png` shows it hidden again after a second F1.

### Follow-ups
- Placeholder crouch and jump reuse the standing frame, and the standing frame (column 2) is mid-stride. This is fine until spec 002's clips land.
- Real clips anchor on the back foot, so the body sits ahead of the fighter's x while the pushbox is centered on x. Combat (spec 003) should add a per-fighter pushbox offset or center on the body.
- No real `public/fighters/<slug>/manifest.json` existed during this work, so the loader is proven on the fixture only. Re-run A11 with `?p1=julien-hovan` once spec 002 packs Julien's set; `window.__game.info().clipSources` should then say `manifest`.
- Integer scaling is in CSS pixels. At a fractional devicePixelRatio (1.5), odd scales are not whole device pixels.
- Gamepad mapping is unit-tested only, not on hardware.

## Review
(filled by spec-review)
