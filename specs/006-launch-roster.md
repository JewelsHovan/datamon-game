# 006: Launch roster and signature specials

Status: in-progress
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
- [ ] A1. (R1) For each new fighter: pytest checks of palette, idle height and manifest pass; every clip passed the frame-by-frame review; generation totals recorded.
- [ ] A2. (R2, R3) Vitest per special: Felicia ends up on the other side of the opponent (or in front when cornered) and cannot be hit while dissolved; Pentcho's charge survives one hit and knocks down on contact; Alex's flurry lands up to four separate hits and the last launches; Julien's projectile behaves as in spec 003. Determinism test with all four fighters.
- [ ] A3. (R4) Effect review in the HQ lab; browser screenshots of each special mid-animation in `specs/evidence/006/`.
- [ ] A4. (R5) Select-screen screenshot showing all four with archetype and special names.

## Out of scope
- Supers and battlemons (spec 007), CPU (spec 008), the other 33 fighters (spec 011).

## Decisions
- Archetype stats are small tweaks; matchups are tuned by feel after the user plays.

## Open questions
- None (archetype assignments are proposals the user can change on the HQ page).

## Tasks
- [ ] T1. Generate, review and approve the three fighters' 26 clips each (after spec 012's T1).
- [ ] T2. Signature special clips per fighter and the special effects.
- [ ] T3. Fighter data table and per-fighter move sets.
- [ ] T4. The three new specials in the sim; tests.
- [ ] T5. Select-screen info; browser evidence; HQ.

## Implementation notes
(filled by spec-tackle)

## Review
(filled by spec-review)
