# 005: Controls for two and the match flow

Status: in-progress
Created: 2026-11-12

## Goal
Two people can sit at one laptop, pick their fighters and play without a cheat sheet: buttons named for what they do (Punch, Kick, Special), hands kept apart on the keyboard, keys they can rebind and test, controllers that just join, and a full arcade loop from title to rematch.

## Context
Round 3 interview, after the user played the MVP (`docs/game-design.md`, "Round 3 interview" and the controls table). Today the game boots straight into a Julien mirror match with Light/Heavy/Special and P2 on `, . /`. The sim maps buttons to moves in `chooseGroundMove` and `tryCancel` in `src/sim/combat.ts`; key bindings live in `src/input/keymap.ts`; the only scene is `src/scenes/sandbox.ts`. Only Julien has generated clips today; spec 006 adds Felicia, Pentcho and Alex in parallel, so the select screen must read the playable list from data and show any fighter with a `public/fighters/<slug>/manifest.json` as playable.

## Requirements
- R1. Button scheme Punch / Kick / Special (reuse the existing light/heavy/special bits as punch/kick/special): Punch = light_punch, forward+Punch = heavy_punch; Kick = light_kick, forward+Kick = heavy_kick; down+Punch or down+Kick = crouch_attack; Punch or Kick in the air = air_attack; Punch+Kick within the chord window = throw; Special = special. Cancels: light_punch into heavy_punch, heavy_kick or special; light_kick into heavy_kick or special; heavy_punch into special. Rename user-facing names everywhere (HUD, controls hints, docs in code comments).
- R2. Default keys from the design doc: P1 W A S D, F punch, G kick, H special; P2 arrows, L punch, ; kick, ' special. Enter starts or confirms, Esc pauses. Game keys never trigger browser shortcuts (preventDefault on bound keys, including Quote and Slash, which open quick find in Firefox).
- R3. Controls screen (from the title and the pause menu): both players' bindings side by side; select an action and press a key to rebind it; binding a key that is already used swaps the two; "restore defaults"; bindings saved in localStorage (reads and writes guarded, the game works without storage). A live key test shows every bound action lighting up per player while held, with a line explaining that a key that does not light up while others are held means the keyboard cannot register that combination, so rebind it.
- R4. Gamepads: the first button press on an unassigned pad assigns it to the first player without one (P1, then P2) and shows a "P1 controller" / "P2 controller" toast. A: punch, B: kick, X or Y: special, Start: start/pause, d-pad or left stick: move. Keyboard keeps working for its player. Unplugging frees the slot.
- R5. Scenes and flow: title (game name, "press start", controls) → character select → versus splash (about 2 seconds) → fight → results (winner, "Rematch" / "Character select") → back to select or rematch. Pause (Esc or Start) during a fight: resume, controls, quit to select. A scene manager owns the flow; the sim and the fight stay as they are apart from R1.
- R6. Character select: a grid of all 37 people. Playable fighters (with a manifest) are lit; the rest are dimmed and marked "coming soon" and cannot be picked. Each player has their own colored cursor (P1 blue, P2 red), moves with their directions, confirms with Punch, cancels with Kick, and gets a large preview of the fighter under the cursor playing its idle clip with the name and archetype. A random tile picks among playable fighters. Picking the same fighter gives P2 the alternate palette. The fight starts when both have confirmed.
- R7. In fights, each player's key legend (their actual bindings) shows under their health bar during the round 1 intro and while paused.
- R8. Tests: unit tests for the R1 mapping (each input picks the right move, including cancels and the throw chord), keymap rebinding with swap and persistence through a fake storage, gamepad assignment order, and the scene flow driven by fake inputs (title → select → versus → fight → results → select and rematch). Existing tests keep passing (update the ones whose button names changed).

## Acceptance criteria
- [ ] A1. (R1, R8) `npm test` exit 0 with the new mapping tests: forward+Punch starts heavy_punch, forward+Kick heavy_kick, down+Kick crouch_attack, Punch+Kick throw, Kick in the air air_attack, light_punch on hit cancels into heavy_punch on forward+Punch.
- [ ] A2. (R2) A browser check presses P2's L, ;, ' and confirms the three moves start; pressing ' and / fires no browser shortcut (the page keeps focus, no find bar; check `document.activeElement` and the `defaultPrevented` flag via a test listener).
- [ ] A3. (R3) Rebinding P1 Punch to a key P2 uses swaps them (unit test and browser screenshot of the controls screen); bindings survive a reload; restore defaults works; the key test lights F, G, H, L, ;, ' together in a screenshot while all six are held.
- [ ] A4. (R4) Unit test: pad A pressed first goes to P1, a second pad to P2, unplugging P1's pad frees P1.
- [ ] A5. (R5, R6) A browser check walks title → select (P1 picks Julien, P2 picks the random tile or Julien) → versus → fight → results → rematch, with screenshots of each screen in `specs/evidence/005/`; dimmed "coming soon" tiles cannot be confirmed.
- [ ] A6. (R7) Screenshot of the round 1 intro showing both players' key legends under the health bars.
- [ ] A7. `npm run typecheck`, `npm run build` exit 0; spec 003's fight check (`specs/evidence/003/fight-check.mjs`, updated for the new keys and the flow) and spec 001's browser check still pass.

## Out of scope
- Audio (spec 010), new animations and specials (specs 006 and 012), stages (spec 009), CPU opponent (spec 008).
- Online play, more than two players.

## Decisions
- Button bits stay the same (light → punch, heavy → kick) so saved inputs and tests keep working; only names and the mapping change.
- The match settings (best of 3, 99 s) are unchanged and not exposed in menus yet.
- localStorage key `datamon.controls.v1`.

## Open questions
- None.

## Tasks
- [ ] T1. Sim mapping in `src/sim/combat.ts` and its tests; rename user-facing labels.
- [ ] T2. Keymap defaults, rebinding model with swap and persistence (`src/input/keymap.ts`, `src/input/bindings.ts`), preventDefault for bound keys.
- [ ] T3. Gamepad join and assignment (`src/input/gamepad.ts`, `src/input/sampler.ts`).
- [ ] T4. Scene manager and scenes: `src/scenes/manager.ts`, `title.ts`, `select.ts`, `versus.ts`, `fight.ts` (the current sandbox fight, parameterized), `results.ts`, `pause.ts`, `controls.ts`; `src/main.ts` boots the title (keep `?mode=training` and `?p1=&p2=` as shortcuts straight into a fight for checks).
- [ ] T5. HUD key legends.
- [ ] T6. Unit tests (mapping, bindings, gamepad, flow).
- [ ] T7. Browser checks and screenshots in `specs/evidence/005/`; update spec 003's fight check for the new keys.

## Implementation notes
(filled by spec-tackle)

## Review
(filled by spec-review)
