# 003: Combat core: the first real fight

Status: in-progress
Created: 2026-11-12

## Goal
Two players can fight a full best-of-3 match: attacks animate from Julien's generated clips, hits land with weight (hit-stop, stun, pushback), blocks work high and low, throws beat blocking, the special throws a projectile, and health bars run down to a K.O. This is the MVP the user plays and reviews.

## Context
Builds on spec 001 (loop, sim, input, clip rendering) and spec 002 (Julien's 17 clips in `public/fighters/julien-hovan/`). The binding rules are in `docs/game-design.md` ("Game loop architecture" items 4 to 7, "Animation clip format", "Core animation set"). Only Julien has clips until spec 006, so the MVP is a mirror match and P2 gets a palette swap, the classic fighting-game answer. Effects are spec 004 and the real HUD and menus are spec 005; this spec draws only what the fight needs to be readable.

Status is `draft` until specs 001 and 002 are done: the tasks below assume their file layout and get a final check against the real code before `/spec-tackle`.

## Requirements
- R1. Move set from simple inputs: light = light_punch; heavy = heavy_punch; forward+light = light_kick; forward+heavy = heavy_kick; down+light or down+heavy = crouch_attack (low); light or heavy in the air = air_attack (overhead); special = special (projectile); light+heavy together near the opponent = throw. Input buffering of 4 frames for presses.
- R2. Frame data as data: every move lists its clip, which clip frames are startup, active and recovery (a frame's hold may be overridden per move), damage, hitstun, blockstun, hit-stop, pushback, chip damage, knockdown flag, and which moves it can cancel into on hit or block (light into heavy into special). One file per fighter, `src/data/moves/<slug>.json`.
- R3. Boxes: every clip frame has hurtboxes; active frames have hitboxes. A pipeline step (`art/pipeline/boxes.py`) derives them from the frames: hurtboxes from the silhouette (head, torso and legs bands), hitboxes from the part of an active frame that sticks out past the idle silhouette's front edge. Results go to `public/fighters/<slug>/boxes.json` with manual overrides in `art/fighters/<slug>/boxes-overrides.json`. F2 toggles a box overlay.
- R4. Hit resolution in the sim's fixed order: both fighters' hitboxes are checked against the other's hurtboxes in the same step, so trades happen ("MERGE CONFLICT!" placeholder text). A move hits at most once. On hit: damage, hit-stop on both fighters (light 6, heavy 10, special 12 frames), hitstun, pushback (the attacker is pushed instead when the defender is in the corner). Heavy kick, sweep and throw knock down; knockdown plays the knockdown clip with a short invulnerable get-up.
- R5. Blocking: holding back blocks standing (stops high and mid, not lows); down-back blocks crouching (stops lows and mids, not overheads). Blocked hits apply blockstun, pushback and chip damage (specials only). Throws cannot be blocked and do not work on airborne or already-stunned opponents.
- R6. Projectile: the special spawns a projectile sim entity (straight line, one hit, cancels against the other player's projectile, one on screen per player), drawn as a placeholder energy ball until spec 004.
- R7. Health, K.O. and rounds: 1000 health each; at 0 the loser plays the K.O. clip (knockdown frames 1 to 4) and the winner plays victory; the round resets after 3 seconds; first to 2 rounds wins, then the match restarts. A minimal HUD: two health bars with a delayed "chip" trail, round pips, and big placeholder text for ROUND N, FIGHT, K.O.
- R8. Mirror match: when both players use the same fighter, P2's frames are drawn with an alternate palette (a mapping over the fighter's `palette.json`), built once at load.
- R9. Determinism holds with combat: the spec 001 determinism test is extended with attacks, blocks, a throw, a projectile and a K.O., and still matches hashes run to run.

## Acceptance criteria
- [x] A1. (R1, R2) Unit tests: each move starts its clip on the press frame (or after a buffered press), its first active frame is the one the frame data names, and its total length equals the sum of its frame holds. `npm test` exit 0.
- [x] A2. (R3) `boxes.json` exists for Julien, every clip frame has at least one hurtbox, every active frame has a hitbox in front of the anchor (positive x for art facing right), and a pytest checks it. Screenshot of the F2 overlay on heavy_punch's impact frame.
- [x] A3. (R4) Tests: a light punch at point-blank hits and applies 6 frames of hit-stop to both fighters, then hitstun; two attacks whose active frames overlap on the same step both land (trade); a move cannot hit twice; a defender in the corner pushes the attacker back instead.
- [x] A4. (R5) Tests: standing block stops light_punch but not crouch_attack; crouching block stops crouch_attack but not air_attack; throw beats standing block; throw whiffs on an airborne opponent.
- [x] A5. (R6) Tests: the projectile travels, hits once, and two projectiles cancel each other; a second special while one projectile is out does nothing.
- [x] A6. (R7) A scripted match in a test ends with one player winning 2 rounds; in the browser, health bars drop on hits, K.O. text appears, the round resets, and a match winner is shown. Screenshots in `specs/evidence/003/`.
- [x] A7. (R8) In the browser a Julien vs Julien match shows P2 in a clearly different palette (screenshot).
- [x] A8. (R9) The extended determinism test passes.
- [ ] A9. The game-qa agent plays a match in the browser and its report shows no blocker; findings are triaged in Implementation notes. Then the user plays it (the MVP review).

## Out of scope
- Effect animations, screen shake, flashes (spec 004).
- Real HUD art, menus, character select, timer (spec 005).
- Other fighters' clips and archetype specials (spec 006); every fighter uses the all-rounder move set for now.
- Supers and battlemons (spec 007), CPU opponent (spec 008).

## Decisions
- Directions in move inputs are relative to facing, resolved in the sim (spec 001 already does this).
- Hitboxes come from the art itself so retouched or regenerated frames update their boxes on the next pipeline run.
- P2's alternate palette is a hue rotation of the dominant clothing colors, kept in `art/fighters/<slug>/palette-alt.json` so it can be hand-tuned.

## Open questions
- None blocking. Final frame data numbers are tuned by feel during the MVP review.

## Tasks
- [x] T1. Move data format and Julien's move file `src/data/moves/julien-hovan.json`.
- [x] T2. `art/pipeline/boxes.py`, overrides, `boxes.json`, pytest.
- [x] T3. Sim: attack states, input-to-move mapping with buffering, cancels.
- [x] T4. Sim: hit detection and resolution (hit-stop, stun, pushback, knockdown, trades), blocking rules, throws.
- [x] T5. Sim: projectile entity.
- [x] T6. Sim: health, K.O., round and match flow.
- [x] T7. Render: clip selection from fighter state, F2 box overlay, palette swap, minimal HUD and placeholder announcer text.
- [x] T8. Tests for A1, A3 to A5, A8.
- [ ] T9. Browser checks, game-qa run, open the game for the user.

## Implementation notes
2026-11-12, lead session.

**What was built**
- Frame data: `src/data/moves.ts` (each move is a timeline of clip-frame segments, so startup, active, recovery and the art come from one list), constants in `src/data/combat.ts`.
- Boxes: `art/pipeline/boxes.py` derives hurtboxes (head, torso, legs bands) and hitboxes (the limb that sticks out past the frame's own body front) into `src/data/boxes/<slug>.json` with a generated index, bundled with the code so the sim stays pure. Generic boxes cover fighters without generated art. The task named `public/fighters/<slug>/boxes.json`; it moved to `src/data/boxes/` for that reason.
- Sim: `src/sim/combat.ts` (buffered input, move starts, cancels, a light/heavy press that completes the throw chord within 2 frames becomes a throw, projectiles, grabs, hit detection for both fighters at once, hit application, pushback with corner transfer, knockdown and K.O.), `src/sim/round.ts` (intro, timer, K.O. and time-out, victory, next round, match restart), state machine extended in `src/sim/fighter.ts`. Facing now turns only for fighters that can act.
- The sandbox is now training mode (`?mode=training`); the default page is a best-of-3 match. Default P2 is `julien-hovan` (mirror match), the only fighter with clips; P2 draws with the alternate palette from `art/pipeline/palette_alt.py`.
- Render: clip selection for every combat state (`src/render/fighterRenderer.ts`), HUD (`src/render/hud.ts`), F2 box overlay (`src/render/boxesOverlay.ts`), and the spec 004 effects layer (`src/render/effects.ts`).
- Fighter anchors moved to the body center in the packer (`originX`), so sprites line up with pushboxes; documented in the design doc.

**Evidence**
- A1, A3, A4, A5, A6, A8: `src/sim/combat.test.ts`, 22 tests (frame data per move, buffering, point-blank hit with 6 frames of hit-stop then 15 of hitstun, trade, one hit per move, corner pushback, block heights both as unit checks and in a match, throw beats block, throw whiffs on a jumper, projectile travel/hit/clash/one-at-a-time, a scripted best-of-3 that P1 wins 2-0, identical hashes across runs and across a JSON round trip). Full suite: `npm test` EXIT=0, 13 files, 129 tests; `npm run typecheck` EXIT=0; `npm run build` EXIT=0.
- A2: pytest `test_julien_boxes` (every frame has hurtboxes, the six attack frames have hitboxes reaching well in front of the anchor and covering the limb, idle has none); F2 overlay screenshot `specs/evidence/003/05-projectile-boxes.png`.
- A6, A7 in the browser: `node specs/evidence/003/fight-check.mjs http://127.0.0.1:5199/ specs/evidence/003` EXIT=0, 11 checks: real clips for both players, light punch hit with spark (`02`), heavy kick knockdown with dust (`03`), P2 block with the shield flash (`04`), projectile with boxes (`05`), K.O. (`06`), victory pose and the round pip (`07`), round 2 intro (`08`), no console errors. `01` shows P2 in the burgundy alternate palette.
- Spec 001 regression: its browser check now runs in training mode and still passes all 13 checks.

**Open**
- A9: game-qa run in progress; the user is playing the MVP.
- Follow-ups: frame data numbers are first guesses, tuned by feel after the user's review.

## Review
(filled by spec-review)
