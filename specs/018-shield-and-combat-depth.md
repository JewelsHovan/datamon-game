# 018: Cardinal Shield, Perfect Guard & Combat Depth (40-Fighter Complete Edition)

Status: review
Created: 2026-11-17

## Goal
Expand the playable Compass roster to **40 / 40** fighters (`8 / 8 / 8 / 8 / 8` perfect archetype symmetry across `80` unique signature specials, adding **Duru Aran**, **Martin Dawson**, and **Walid Aissa**), and deepen 1v1 combat skill expression within the existing 3-button scheme via **Cardinal Shield** (Guard Integrity + Shield Break), **3-frame Perfect Shield** (Just Defend), **Air Shield**, **8-frame Throw Tech**, **3-Way Wakeup Options**, and **Counter / Punish** frame-advantage bonuses and HUD callouts.

## Requirements
- R1. **40-Fighter Symmetric Roster (`80` Specials)**:
  - Add `duru-aran` (Trickster: `quant_counter`, `alpha_pulse`), `martin-dawson` (Bruiser: `pipeline_crush`, `schema_lock`), and `walid-aissa` (Zoner: `vector_lance`, `tensor_arc`) with Datamon portraits, 4-direction walk sheets, 26-clip v2 pixel-art atlases, head-protected mirror-match `atlas-alt.webp`, and derived hurt/reach boxes.
  - Archetype distribution across all 40 fighters: `8` All-rounders, `8` Rushers, `8` Bruisers, `8` Zoners, `8` Tricksters.
  - Character Select (`src/scenes/select.ts`) uses a 9-column compact grid (`41` tiles = `5` rows) so all 40 fighters + Random fit cleanly above the CPU level selector at `640x360`.
- R2. **Cardinal Shield, Perfect Shield & Air Shield (`src/sim/combat.ts`, `src/sim/fighter.ts`, `src/render/hud.ts`)**:
  - Integer `guard` gauge (`0..1000`) per fighter: drains on blocked strikes (`90` light / `210` heavy / `250` special, modulated by `chipResistPct`), costs `220` Guard to Pushblock (`Punch+Kick` in blockstun), and regenerates (`4/frame`) after a `45`-frame cooldown outside blockstun.
  - Reaching `0` Guard triggers `guard_break` (`42`-frame vulnerable stagger + `"SHIELD BREAK!"` callout, shatter VFX/SFX, refilling to `650` Guard on recovery).
  - **Perfect Shield (`3`-frame window):** Pressing `Back` within `3` frames before impact negates chip damage, restores `+160` Guard, shaves `5` frames off defender blockstun, and triggers `"PERFECT SHIELD"` HUD/VFX/SFX feedback.
  - **Air Shield:** Holding `Back` while airborne (without an active air attack) blocks projectiles and air-to-air strikes at `1.5x` Guard cost, while grounded anti-airs remain air-unblockable.
- R3. **Throw Escape, 3-Way Wakeup & Counter/Punish Depth**:
  - **Throw Tech (`8` frames):** Pressing `Punch+Kick` within `8` frames after a normal throw connects escapes into neutral with mutual pushback (`tech` event); command grabs remain untechable.
  - **3-Way Wakeup:** Downed fighters can **Back Roll** (`Back`), **Forward Cross-Up Roll** (`Forward`), or **Quick Rise** (`Up`, `-14f` lying time), with the final `5` frames of rolls exposing hurtboxes so predictable rolls can be baited.
  - **Counter & Punish:** Striking an opponent out of attack startup grants `+3` frames hitstun and emits a `"COUNTER!"` callout; striking recovery, taunt, or `guard_break` emits `"PUNISH!"`.
- R4. **Determinism, CPU AI, Audio/VFX & Gate Verification**:
  - `src/sim` remains 100% integer-only and deterministic (`hashState` + JSON round-trip).
  - CPU AI (`src/ai/cpu.ts`) punishes `guard_break`, techs normal throws by difficulty, manages Guard before pushblocking, and maps all `88` `MoveId`s (`8` universal + `80` specials).

## Acceptance criteria
- [x] A1. All 40 fighters (`duru-aran`, `martin-dawson`, `walid-aissa` included) pass `art/pipeline/verify_fighter.py` and `pytest art/pipeline/tests`.
- [x] A2. Blocking drains `guard`, Pushblock requires/spends `220` Guard, `0` Guard enters `guard_break` (`42f` vulnerable stagger), and Guard regenerates after `20f`.
- [x] A3. Pressing `Back` within `3` frames of impact triggers `perfect_block` (`0` chip, `+160` Guard, reduced blockstun); airborne `Back` blocks projectiles and air-to-air attacks while grounded anti-airs hit through.
- [x] A4. Normal throws can be teched within `8` frames via `Punch+Kick` while command grabs stay untechable; wakeup supports Back Roll, Forward Roll (vulnerable final `5f`), and Quick Rise; startup counter-hits grant `+3f` hitstun and `"COUNTER!"` / `"PUNISH!"` callouts.
- [x] A5. `./dm check` (`typecheck`, `test`, `build`) exits `0`.

## Tasks
- [x] T1. Build Datamon portraits, walk sheets, and 26-clip v2 fighter atlases + alt palettes + hitboxes for `duru-aran`, `martin-dawson`, and `walid-aissa`.
- [x] T2. Wire `duru-aran`, `martin-dawson`, and `walid-aissa` (`80` specials, `8/8/8/8/8` archetype symmetry) and 9-column Character Select grid (`41` tiles).
- [x] T3. Implement Cardinal Shield (`guard` drain, Pushblock cost, Shield Break, regen), 3f Perfect Shield, Air Shield, 8f Throw Tech, 3-Way Wakeup, and Counter/Punish hitstun/callouts in `src/sim/`.
- [x] T4. Render Shield Gauge & callout popups in `src/render/hud.ts`, add VFX/SFX in `src/render/effects.ts` & `src/audio/sfx.ts`, and wire CPU AI in `src/ai/cpu.ts`.
- [x] T5. Verify with `src/sim/shieldDepth.test.ts`, `./dm check`, and `art/pipeline/tests`.
