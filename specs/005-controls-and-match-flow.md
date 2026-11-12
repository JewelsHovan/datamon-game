# 005: Controls for two and the match flow

Status: review
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
- [x] A1. (R1, R8) `npm test` exit 0 with the new mapping tests: forward+Punch starts heavy_punch, forward+Kick heavy_kick, down+Kick crouch_attack, Punch+Kick throw, Kick in the air air_attack, light_punch on hit cancels into heavy_punch on forward+Punch.
- [x] A2. (R2) A browser check presses P2's L, ;, ' and confirms the three moves start; pressing ' and / fires no browser shortcut (the page keeps focus, no find bar; check `document.activeElement` and the `defaultPrevented` flag via a test listener).
- [x] A3. (R3) Rebinding P1 Punch to a key P2 uses swaps them (unit test and browser screenshot of the controls screen); bindings survive a reload; restore defaults works; the key test lights F, G, H, L, ;, ' together in a screenshot while all six are held.
- [x] A4. (R4) Unit test: pad A pressed first goes to P1, a second pad to P2, unplugging P1's pad frees P1.
- [x] A5. (R5, R6) A browser check walks title → select (P1 picks Julien, P2 picks the random tile or Julien) → versus → fight → results → rematch, with screenshots of each screen in `specs/evidence/005/`; dimmed "coming soon" tiles cannot be confirmed.
- [x] A6. (R7) Screenshot of the round 1 intro showing both players' key legends under the health bars.
- [x] A7. `npm run typecheck`, `npm run build` exit 0; spec 003's fight check (`specs/evidence/003/fight-check.mjs`, updated for the new keys and the flow) and spec 001's browser check still pass.

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
- [x] T1. Sim mapping in `src/sim/combat.ts` and its tests; rename user-facing labels.
- [x] T2. Keymap defaults, rebinding model with swap and persistence (`src/input/keymap.ts`, `src/input/bindings.ts`), preventDefault for bound keys.
- [x] T3. Gamepad join and assignment (`src/input/gamepad.ts`, `src/input/sampler.ts`).
- [x] T4. Scene manager and scenes: `src/scenes/manager.ts`, `title.ts`, `select.ts`, `versus.ts`, `fight.ts` (the current sandbox fight, parameterized), `results.ts`, `pause.ts`, `controls.ts`; `src/main.ts` boots the title (keep `?mode=training` and `?p1=&p2=` as shortcuts straight into a fight for checks).
- [x] T5. HUD key legends.
- [x] T6. Unit tests (mapping, bindings, gamepad, flow).
- [x] T7. Browser checks and screenshots in `specs/evidence/005/`; update spec 003's fight check for the new keys.

## Implementation notes

### What was built
- **T1, mapping (R1).** `src/sim/combat.ts`: one helper `normalFor(button, dirs)` maps Punch/Kick plus the held directions to a move, and both `chooseGroundMove` and `tryCancel` use it, so a cancel is "the move this input would start from neutral, if the current move's cancel list allows it". The cancel lists in `src/data/moves.ts` already matched R1 and were not touched. `tryThrowConversion` now converts any Punch or Kick normal (light/heavy punch, light/heavy kick, crouch attack) when the partner button arrives within the chord window; before, only punches converted. Rest of combat.ts unchanged. `src/sim/inputBits.ts`: `BUTTON_PUNCH`/`BUTTON_KICK` (same bits as before), `BUTTON_LIGHT`/`BUTTON_HEAVY` kept as aliases so other workstreams still compile; button names are now `punch`/`kick`. The old `combat.test.ts` inputs were moved to the new mapping (no test deleted); the scripted match uses forward+bit 5, which is the same heavy kick under both schemes, so its hashes did not change.
- **T2, keys (R2, R3).** `src/input/keymap.ts`: the home-row defaults (P1 W A S D F G H, start Enter; P2 arrows L ; ', start NumpadEnter), `keyLabel()`, and `ALWAYS_BLOCKED_KEYS` (Quote, Slash, Space, Tab, Backspace, arrows, Enter, Escape: blocked even when unbound). `src/input/bindings.ts`: `ControlBindings`, one key per action, rebinding a used key swaps the two actions (across players too), `restoreDefaults()`, persisted as `datamon.controls.v1` with every storage read and write in try/catch; corrupt or conflicting saved data falls back to the defaults. Escape, Tab, F-keys and Ctrl/Alt/Meta cannot be bound (they reach browser shortcuts). `src/input/keyboard.ts` reads the bindings live and calls preventDefault for game keys unless Ctrl or Meta is held (Cmd+F and friends stay the user's).
- **T3, gamepads (R4).** `src/input/gamepad.ts`: `PadSlots` assigns a pad on its first button press to the first player without one (P1, then P2), frees the slot when the pad disappears or reports `connected: false`, ignores a third pad, and holds back the joining press until it is released (so joining does not also confirm). X or Y is Special. Join and leave show a "P1 CONTROLLER" / "P1 CONTROLLER UNPLUGGED" toast. `sampler.ts` needed no change (it already ORs keyboard and pad per player).
- **T4, scenes (R5, R6).** `src/scenes/manager.ts` owns the flow; every scene steps at 60 Hz with the sampled input (`step(input)`) and draws separately (`render`), so the whole flow runs headless in tests. Scenes: `title.ts`, `select.ts`, `versus.ts` (2 s splash that also loads the fight's assets), `fight.ts` (the old `sandbox.ts`, moved with `git mv` and parameterized by a `Match`), `pause.ts`, `results.ts`, `controls.ts`. Esc is a fixed key (pause in a fight, back elsewhere, cancel while rebinding). Pause: Esc or any human's Start; in the pause menu Punch or Start confirms the selected item (RESUME is selected first, so Start toggles). The results screen appears 150 frames into the sim's match-over phase (the sim would restart the match at 300). `src/main.ts` boots `startGame()` (title, or a fight straight away for `?p1=&p2=`, `?mode=training`, `?cpu=`).
- **Character select.** Grid of the 37 people in catalog order plus a random tile (8 columns, wrapping). Playable = the fighter's `manifest.json` parses, detected at runtime by fetching every manifest (`src/scenes/roster.ts`, `detectPlayable`). Dimmed tiles refuse a pick (cursor shakes). Same fighter for both: P2 gets the alternate palette (preview and fight). Archetype and special name come from `src/data/fighters.ts` when it exists, read through `fighterInfo()` with `import.meta.glob` (no build error while the file is missing; any record keyed by slug or array with `slug`, fields `archetype` and `specialName`/`specialDisplayName`/`specialLabel`/`special.name`). Until then the fallback is "All-rounder" / "Data Orb" for Julien only. To switch to the real table, nothing needs to change unless its field names differ; then adjust `entryInfo()` in `roster.ts`.
- **Controls screen.** Rows are actions, columns are players. Start (Enter, NumpadEnter or pad Start) begins a rebind; the next key press binds. Punch, Kick and Special do nothing there except light up, so the six attack keys can be held together for the key test. After a rebind, input is ignored until the new key is released (it may now be a Start key).
- **T5, key legends (R7).** `src/render/hud.ts`: `legendLines(bindings, hasPad)` builds two lines from the player's actual keys ("F PUNCH  G KICK  H SPECIAL" / "WASD MOVE  F+G THROW"), or pad buttons when the player holds a gamepad, or "CPU HARD" for a CPU slot. Drawn under each health bar during the round 1 intro, in training, and while paused. The bottom-center controls text of the sandbox is gone. "PROD IS DOWN. RESTARTING..." became "PROD IS DOWN." since the match no longer restarts by itself.

### Scope addition from the lead: VS CPU plumbing (spec 008 plugs in)
- Title modes: VS CPU, VS PLAYER, TRAINING (goes through select into the free training fight), CONTROLS.
- VS CPU select: P1 picks their fighter, then the CPU's fighter with P1's controls (cursor starts on the random tile, the "random opponent" default), then EASY / NORMAL / HARD (default NORMAL). Kick steps back one stage. P2's keys do nothing on this screen.
- `src/ai/cpu.ts` holds exactly the given interface and placeholder; no logic lives there. `FightScene` creates `createCpu(level, 1, match.seed)` through `GameServices.createCpu` and, for a CPU slot, feeds `cpu.decide(state)` (the pre-step state) to the sim instead of the sampled input. Only human slots can pause.
- `?cpu=easy|normal|hard` starts a VS CPU fight with P2 as the CPU (unknown level: warning, NORMAL).
- Unit tests in `src/scenes/flow.test.ts`: the flow reaches a VS CPU fight at each level with the CPU seeded from the match; the CPU slot's input comes from `decide()` (fake controller says down, P2's keys say up for 140 steps: P2 crouches, never jumps; one `decide` call per sim step with frames 0..139); P2's Start does not pause a CPU fight.

### Files outside the task list
- `src/scenes/game.ts`: the browser bootstrap (devices, bindings, pads, asset loading, loop, `window.__game`), kept out of `main.ts` and `manager.ts` so the manager stays testable.
- `src/scenes/ui.ts`: the shared list menu, input helpers, colors and backdrop.
- `src/scenes/roster.ts`: playable detection and the fighter-info adapter.
- `src/ai/cpu.ts`: the lead's CPU interface.
- `src/scenes/fight.test.ts`: the old `sandbox.test.ts` (moved), plus tests for the new shortcuts.
- `src/data/combat.ts`: one comment ("Punch and Kick" for the throw chord).

### `window.__game` (browser checks)
Same fields as before (`simFrame`, `snapshot()`, `hashState()`, `info()`, `events()`, for the current or last fight; `snapshot()` is null before the first fight), plus `scene`, `frame` (manager steps) and `menu()` (the current scene's state: cursors, picks, menu index, key test, bindings).

### Evidence
- A1: `npm test` exit 0, 192 tests in 16 files (129 before). Mapping tests in `src/sim/buttons.test.ts` (22): forward+Punch heavy_punch, forward+Kick heavy_kick, down+Kick and down+Punch crouch_attack, Punch+Kick throw (same frame, 1 and 2 frames apart, from a crouch attack; 3 frames apart is not a throw), Kick and Punch in the air air_attack, light_punch on hit cancels into heavy_punch on forward+Punch (and heavy_kick, special), light_kick into heavy_kick and special but not heavy_punch, heavy_punch into special, no cancel on whiff, P2 facing left.
- A2: `node specs/evidence/005/flow-check.mjs http://127.0.0.1:5301/ specs/evidence/005` exit 0 (22 checks, `results.json`). P2's L, ; and ' start light_punch, light_kick and special (attack events for player 1). ' and / keydowns are `defaultPrevented` as seen by a test listener added after the game's, no keypress follows, `document.activeElement` stays body and the page keeps focus. Screenshot `a2-p2-keys.png`. (Headless Chrome has no quick-find bar; the prevented keydown is what suppresses it in Firefox.)
- A3: unit tests in `src/input/bindings.test.ts` (swap across and within players, persistence through a fake storage, restore defaults, null and throwing storage, corrupt data). Browser: `a3-01-controls-swap.png` (P1 PUNCH = L, swapped with P2 PUNCH), `a3-02-after-reload.png` (still swapped after a reload, read back from localStorage), `a3-03-defaults-restored.png`, `a3-04-key-test-six-held.png` (F G H L ; ' held together, all six rows lit).
- A4: `src/input/gamepad.test.ts`, "pad A pressed first goes to P1, a second pad to P2, unplugging P1's pad frees P1" plus join-press suppression, a third pad, `connected: false`. Not tried with a physical pad (none in headless Chrome).
- A5: flow check screenshots `a5-01-title.png`, `a5-02-select.png`, `a5-03-coming-soon.png` (P1 on Pentcho presses Punch, nothing locks), `a5-04-select-ready.png` (P1 Julien, P2 the random tile, resolved to Julien), `a5-05-versus.png`, `a6-round1-intro-legends.png` (fight), `a5-06-results.png`, `a5-07-rematch.png`, `a5-08-pause.png`, `a5-09-back-to-select.png`. Unit flow tests in `src/scenes/flow.test.ts` cover the same path plus results -> character select, pause -> controls -> pause, Esc on select, training.
- A6: `a6-round1-intro-legends.png`; the check also compares `menu().legends` with the expected strings.
- A7: `npm run typecheck` exit 0; `npm run build` exit 0. `node specs/evidence/003/fight-check.mjs http://127.0.0.1:5301/ <scratch dir>` exit 0 (log `regress-003-fight-check.log`; the check now opens `?p1=julien-hovan&p2=julien-hovan` and knows L ; '). `node specs/evidence/001/browser-check.mjs http://127.0.0.1:5301/ <scratch dir>` exit 0 (log `regress-001-browser-check.log`; A4 advanced exactly 600 frames in 10 s). Both wrote their screenshots to a scratch directory so the 001 and 003 evidence stays as recorded; only the logs are kept here.
- VS CPU: `cpu-01-select-level.png` (P1 Julien, CPU on the random tile, HARD), the flow check reaches a fight with `cpu: [null, "hard"]`, and `?cpu=easy` starts one directly (`cpu-02-shortcut-intro.png`, P2's legend reads "CPU EASY").

### Follow-ups
- Wire audio (spec 010) through `GameOptions.hooks` in `src/main.ts`: `simEvents`, `ui`, `scene`.
- The versus splash shows the same portrait for a mirror match (portraits have no alternate palette).
- Physical gamepad check by the user (join toast, A/B/X/Y, unplug).
- Once spec 006 lands, confirm `src/data/fighters.ts` field names match what `roster.ts` reads (a unit test there covers the expected shapes).

## Review
(filled by spec-review)
