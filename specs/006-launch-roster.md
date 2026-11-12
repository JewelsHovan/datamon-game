# 006: Launch roster and signature specials

Status: review
Created: 2026-11-12

## Goal
Players pick between four fighters who look and play differently: Julien (all-rounder), Felicia (trickster), Pentcho (bruiser) and Alex (rusher), each fully animated with clip set v2 and each with a signature special that has its own animation and effect.

## Context
Round 3 interview ("4 fighters, own specials"); archetypes and specials are proposed in `docs/game-design.md` ("Launch fighters"), changeable on the HQ page. The pipeline (spec 002) and clip set v2 (spec 012) make the art. Character select (spec 005) lists any fighter with a manifest as playable. Move data today is one shared table (`src/data/moves.ts`); combat lives in `src/sim/combat.ts`.

## Requirements
- R1. Felicia G., Pentcho T. and Alex A.: all 26 clip set v2 clips generated, reviewed, approved, packed, with palette, alternate palette and derived boxes; GIFs in the HQ Animation lab.
- R2. Fighter data table (`src/data/fighters.ts`): archetype, health, walk speeds, damage scale, signature special id, display name for the special. All-rounder is the baseline; the others vary by at most 15%.
- R3. Signature specials (sim, deterministic):
  - Julien, Data Orb: today's projectile.
  - Felicia, Context Switch: dissolves (invulnerable, not drawn) and reappears behind the opponent, then a kick; if the opponent is cornered she reappears in front.
  - Pentcho, Hotfix Charge: shoulder charge forward; absorbs the first hit during the charge (takes damage, no stun); a connected charge knocks down.
  - Alex, Rapid Deploy: dash forward into three quick punches (each segment hits once) and an uppercut that launches.
- R4. Each special has its own clip (generated per fighter) and effect (teleport_out and teleport_in for Felicia, charge streaks for Pentcho, rush streaks and an uppercut arc for Alex), generated through the effects pipeline.
- R5. The select screen shows each fighter's archetype and special name.

## Acceptance criteria
- [x] A1. (R1) For each new fighter: pytest checks of palette, idle height and manifest pass; every clip passed the frame-by-frame review; generation totals recorded.
- [x] A2. (R2, R3) Vitest per special: Felicia ends up on the other side of the opponent (or in front when cornered) and cannot be hit while dissolved; Pentcho's charge survives one hit and knocks down on contact; Alex's flurry lands up to four separate hits and the last launches; Julien's projectile behaves as in spec 003. Determinism test with all four fighters.
- [x] A3. (R4) Effect review in the HQ lab; browser screenshots of each special mid-animation in `specs/evidence/006/`.
- [x] A4. (R5) Select-screen screenshot showing all four with archetype and special names.

## Out of scope
- Supers and battlemons (spec 007), CPU (spec 008), the other 33 fighters (spec 011).

## Decisions
- Archetype stats are small tweaks; matchups are tuned by feel after the user plays.

## Open questions
- None (archetype assignments are proposals the user can change on the HQ page).

## Tasks
- [x] T1. Generate, review and approve the three fighters' 26 clips each (after spec 012's T1).
- [x] T2. Signature special clips per fighter and the special effects.
- [x] T3. Fighter data table and per-fighter move sets.
- [x] T4. The three new specials in the sim; tests.
- [x] T5. Select-screen info; browser evidence; HQ.

## Implementation notes
2026-11-12, lead session (art; the specials sim T3-T5 follow once spec 005 merges).

- Felicia, Pentcho and Alex: idle generated in 2 variants each and the steadiest kept (Felicia 0, Pentcho 1, Alex 0), then the other 25 clips of set v2 each, reviewed frame by frame and approved (26/26 each). Packed atlases 1024x1533 to 1024x1692. Images: 29, 28 and 28 including the crouch_hurt and throw regenerations.
- Signature special clips: Felicia's Context Switch (crouch, spin, reappear into a jumping kick), Pentcho's Hotfix Charge (shoulder down, two running frames, slam), Alex's Rapid Deploy (dash, jab, straight, hook, crouch, rising uppercut, land).
- Special effects generated and approved: teleport_out, teleport_in, charge_streaks, rush_streaks, uppercut_arc.
- Alternate palettes reworked so they recolor the top garment (colors mostly in the torso band and not in the head band, skin excluded; black or grey garments are tinted): Julien maroon, Felicia navy, Pentcho blue blazer, Alex mustard.
- A1: pytest passes for palettes, idle heights and manifests of all four.

2026-11-12, lead session (T3-T5).

- Fighter table `src/data/fighters.ts`: archetype, health (950-1100), damage (95-108%), walk speed (92-108%), the signature special's move id and display name. The Special button starts the fighter's own special (`startMove` resolves it); the HUD bar scales to each fighter's own maximum health.
- Specials are move timelines in `src/data/moves.ts` with per-segment flags: Context Switch (`hidden` segments, vanish at tick 8, reappear at tick 16 behind the opponent or in front of a cornered one, then an overhead kick), Hotfix Charge (`armor` segments absorb one hit, `vx` carries Pentcho forward, a connected charge launches), Rapid Deploy (`multiHit`: dash, three punches, an uppercut that launches; each segment hits once). Segments may carry a fallback `reach` box where the art detector found none (Alex's hook and uppercut, Pentcho's slam).
- Effects follow the specials from sim state each step: charge_streaks, rush_streaks, uppercut_arc; teleport_out and teleport_in on the teleport events. The CPU knows the new specials (reach, and which range each suits).
- A2: `src/sim/mechanics.test.ts` (Context Switch side switch, cornered case, invulnerable vanish; Hotfix Charge armor once, knockdown, 108% damage; Rapid Deploy 4 hits with a launch, a jab juggle after it in a 12-frame window; the Data Orb; 2400-frame random-input determinism for four pairings incl. a JSON round trip).
- A3: the special effects were reviewed and approved when generated (T2); screenshots of each special mid-animation in `specs/evidence/006/` from `specs/evidence/012/moves-check.mjs`.
- A4: `specs/evidence/006/select-pentcho-alex.png` with Pentcho (Bruiser, Hotfix Charge) and Alex (Rusher, Rapid Deploy); `specs/evidence/006/select-julien-felicia.png` (from spec 005's flow check, this run) shows Julien (All-rounder, Data Orb) and Felicia (Trickster, Context Switch).

## Review
(filled by spec-review)
