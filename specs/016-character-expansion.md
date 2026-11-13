# 016: Roster expansion (12 fighters) and full unique kits

Status: review
Created: 2026-11-12

## Goal
Expand the playable roster from 4 to 12 fully animated fighters covering all five archetypes (All-rounder, Rusher, Bruiser, Zoner, Trickster), and give every playable fighter a genuinely distinct feel: two signature specials (`Special` and `Forward + Special`), per-fighter movement/jump/dash/throw/pushback/cancel tuning, passive traits, custom special animations and visual/audio flavor, and Compass-themed win quotes.

## Context
Specs 006 and 012 established the 26-clip v2 animation pipeline and the first four launch fighters (`julien-hovan`, `felicia-gorgacheva`, `pentcho-tchomakov`, `alex-andrianavalontsalama`), who currently share identical jump/dash/throw/normal frame physics and have one neutral special each (with zero Zoners). `docs/game-design.md` defines all five archetypes, directional specials, and batch roster expansion.

## Requirements
- R1. Eight new playable fighters processed end-to-end through the 26-clip v2 pipeline (`idle` calibration + 25 clips incl. custom `special`, palette lock <= 48 colors, `palette-alt.json`, `atlas.webp` + `manifest.json`, derived `src/data/boxes/<slug>.json`, updated `public/fighters/index.json` and `src/data/boxes/index.ts`):
  - `ethan-pirso` (Zoner — Packet Sniper / Rate-Limit Mine)
  - `megane-darnaud` (Trickster — Rollback Parry / Velvet Cross)
  - `jerry-zhu` (All-rounder — Skyline Upper / Twin Thread)
  - `scott-carr` (Bruiser — Force Push / Breaker Lariat)
  - `antonia-nistor` (Rusher — Golden Rush / Crown Dive)
  - `vincent-anctil` (Zoner — Ground Fault / Arc Beacon)
  - `saransh-padhy` (Trickster — Cache Blink / Mirage Trap)
  - `tyler-nagano` (Bruiser — Anvil Drop / Steel Counter)
- R2. Two signature specials per playable fighter (`Special` = primary neutral special, `Forward + Special` = secondary directional special; `Down + Special` remains taunt), upgrading the original four fighters as well so all 12 fighters wield two specials.
- R3. Distinct deterministic combat mechanics in `src/sim/` (pure integer math, no `Math.random` or DOM):
  - Multi-kind projectiles (`orb`, `fast_packet`, `slow_mine` lingering trap, `shockwave` low floor wave, `arc_burst` angled anti-air pulse) with per-projectile speed, lifetime, height, damage and stun.
  - Counter/parry stance (`counter` segments absorb a strike and trigger an automatic reversal hit + `counter` event).
  - Unblockable grounded command grab (`commandGrabTick`) that beats block and whiffs airborne foes.
  - Air-invulnerable rising anti-air uppercuts and advancing low/overhead special strikes (`vy` / `vx` segment arcs).
- R4. Per-fighter physics, normal feel, and passive traits in `src/data/fighters.ts` & `src/sim/`: health, damage scale, walk speed, dash speed, backdash invulnerability frames, jump launch/horizontal speed and gravity offset, throw range and throw damage, pushback scale, chip-damage resistance, combo floor bonus, and archetype cancel chains (`rush-chain`, `heavy-cancel`, `poke-cancel`, `standard`).
- R5. Presentation, CPU & stage integration:
  - Character Select & Versus show archetype, passive trait, and both special names; Results shows fighter-specific friendly Compass work win quotes.
  - `EffectsLayer` and `sfx.ts` render all new projectile kinds, counter flashes/sounds, and subtle per-fighter SFX pitch identity.
  - `createCpu` understands all 24 specials' ranges and roles (long-range zoning, mines, anti-airs, command grabs, counters, rushdowns).
  - `art/stages.json` excludes all 12 playable fighters from background walkers while keeping a 7-coworker walker cast.

## Acceptance criteria
- [x] A1. (R1) All 12 fighters pass `pytest art/pipeline/tests` and `art/pipeline/verify_fighter.py`: 26 approved clips each, <= 48 palette colors, WebP visible mismatch 0, derived hurtboxes on every frame, `public/fighters/index.json` and `src/data/boxes/index.ts` list all 12, and zero playable fighters appear in `office` walkers.
- [x] A2. (R2, R3, R4) Vitest verifies `Special` vs `Forward + Special` across all 12 fighters, each new mechanic (lingering mine, low shockwave, fast packet, parry counter reversal, command grab vs block and vs jump, rising anti-air invuln, per-fighter jump/dash/throw/cancel/chip traits), and 2400-frame seeded determinism across the expanded roster.
- [x] A3. (R5) CPU, renderer/effects, audio routing, and scene flow tests pass (`./dm check` exits 0 across `typecheck`, `test`, `build`).

## Out of scope
- Full Battlemon super meter summons (spec 007) and the remaining 25 coworkers (future batches).

## Decisions
- `Forward + Special` triggers every fighter's secondary special so it mirrors `Forward + Punch` and `Forward + Kick` without quarter-circle motion inputs.
- `art/stages.json` walker step changes from `every: 5` to `every: 3` so 25 non-playable coworkers still yield 7 background walkers.

## Open questions
- None.

## Tasks
- [x] T1. Author spec 016, custom `special` pose definitions in `art/clips.json`, stage walker exclusion update, and parallel-safe `--skip-index` + `verify_fighter.py` helpers.
- [x] T2. Generate, process, verify, approve, pack, recolor, and box-derive all 8 new fighters in parallel.
- [x] T3. Implement 12-fighter profiles, 24 special moves, per-fighter physics/traits, and new sim mechanics (`src/data/`, `src/sim/`).
- [x] T4. Update CPU AI, effects & audio routing, and Select/Versus/Results UI (`src/ai/`, `src/render/`, `src/audio/`, `src/scenes/`).
- [x] T5. Sync fighter/box indexes, update roster count tests, run `pytest` and `./dm check`, and record evidence.

## Implementation notes
- **Art pipeline (8 new fighters, 217 OpenAI `gpt-image-2.5-sunburst` strips logged in `art/generation-log.jsonl`)**:
  - Built complete 26-clip / 142-frame v2 atlases, `palette-alt.json` (gold hue `45`), `manifest.json`, and `src/data/boxes/<slug>.json` for `ethan-pirso`, `megane-darnaud`, `jerry-zhu`, `scott-carr`, `antonia-nistor`, `vincent-anctil`, `saransh-padhy`, and `tyler-nagano`.
  - Added `art/fighters/megane-darnaud/anchors.json` (`heavy_kick[6]` `[-26, 0]`) so every frame across all 12 manifests stays within the `80px` camera screen margin (`spec 001 A12`), and enforced `ax <= 80` in `art/pipeline/verify_fighter.py`.
  - Updated `art/stages.json` (`walkers.exclude` for all 12 playable fighters, `walkers.every: 3`) and rebuilt `office` stage walkers (`7` coworkers, `0` fighter overlap).
- **24 specials + unique fighter kits (`src/data/moves.ts`, `src/data/fighters.ts`, `src/sim/`)**:
  - Every playable fighter now has a neutral `Special` and a `Forward + Special` (24 distinct specials total), passive trait, Battlemon companion mapping, custom `sfxPitch`, friendly Compass work win quote, and tuned `health`, `damagePct`, `walkPct`, `dashSpeedPct`, `dashBackInvuln`, `jumpVyPct`, `jumpVxPct`, `gravityOffset` (even integer), `throwRangePct`, `throwDamagePct`, `pushbackPct`, `chipResistPct`, `comboFloorPct`, and `chainTrait`.
  - Pure integer simulation adds 5 projectile types (`orb`, `fast_packet`, `slow_mine`, `shockwave`, `arc_burst`), `counter` parry reversals (`counter` SimEvent), unblockable grounded command grabs (`commandGrabTick`), and rising anti-air invulnerability windows.
- **CPU, VFX, Audio, and UI (`src/ai/`, `src/render/`, `src/audio/`, `src/scenes/`, `src/main.ts`)**:
  - `src/ai/cpu.ts` covers all 32 `MoveId`s with archetype spacing, mine setup, command-grab pressure, parry reaction, and projectile jump-ins.
  - `EffectsLayer` and `sfx.ts` render/play distinct visuals and WebAudio recipes (`counter`, `mine_set`, `shockwave`, pitched `attack`/`taunt` via `SimState`).
  - `SelectScene`, `VersusScene`, and `ResultsScene` surface archetype, passive trait, primary + `F+` secondary special names, and per-fighter win quotes.
- **Verification**:
  - `art/pipeline/verify_fighter.py` across all 12 slugs: `PASS` (`12/12`, exit `0`).
  - `uv run --with pytest --with pillow --with numpy --with scipy pytest art/pipeline/tests -q`: `67 passed` (exit `0`).
  - `./dm check`: `PASS typecheck` (`0.3s`), `PASS test` (`31` test files, `447` tests passed, `1.1s`), `PASS build` (`dist/assets/index-*.js` `322.62 kB` / `90.55 kB` gzip, `0.4s`), exit `0`.

## Review
(filled by spec-review)
