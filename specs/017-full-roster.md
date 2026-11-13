# 017: Complete 37-fighter roster (74 specials, dynamic walkers, full unique kits)

Status: review
Created: 2026-11-12

## Goal
Complete the entire 37-person Compass roster (`+25` remaining fighters on top of spec 016's 12, reaching `37 / 37` playable fighters) with full 26-clip v2 pixel-art atlases, 74 distinct signature specials (`Special` and `Forward + Special` across all 37 fighters), per-fighter physics/cancel/passive traits, all 35 Battlemon companions represented, and dynamic stage walker filtering so the office stays populated while active combatants never walk behind their own match.

## Context
Spec 016 expanded the roster from 4 to 12 playable fighters and introduced dual specials (`Special` + `Forward + Special`), multi-kind projectiles (`orb`, `fast_packet`, `slow_mine`, `shockwave`, `arc_burst`), counter parries, command grabs, and per-fighter physics/cancel modifiers. Twenty-five colleagues in `src/data/catalog.ts` still show as `"COMING SOON"` on Character Select, and `art/stages.json` previously relied on static build-time exclusion of playable fighters from the background walker strip (which would leave zero walkers once all 37 colleagues are playable).

## Requirements
- R1. All 25 remaining colleagues processed end-to-end through the 26-clip v2 art pipeline (`idle` calibration + 25 clips including custom 8-pose `special` per fighter in `art/clips.json`, palette <= 48 colors, `palette-alt.json` hue-45 gold mirror recolor, lossless `atlas.webp` + `manifest.json`, derived `src/data/boxes/<slug>.json`, and `ax <= 80` camera margin compliance):
  - Batch A (8): `andrea-vreugdenhil`, `aurelien-bouffanais`, `dana-domanko`, `duc-an-nguyen`, `elina-gu`, `emile-moffatt`, `francesco-finn`, `guillaume-delmas-frenette`
  - Batch B (8): `guillaume-pregent`, `jewoo-lee`, `jonah-lee`, `jonathan-kim`, `logan-labossiere`, `milen-thomas`, `minh-ngoc-do`, `oyku-cildir`
  - Batch C (9): `philippe-miranda-jean`, `richard-el-chaar`, `sarah-kotb`, `stephanie-fontaine`, `tabarek-al-khalidi`, `veronica-marallag`, `victor-desautels`, `wild-guevera`, `william-chan`
- R2. Balanced 37-fighter roster & 74 unique specials (`src/data/fighters.ts`, `src/data/moves.ts`):
  - Archetype distribution across all 37 fighters: 8 All-rounders, 8 Rushers, 7 Bruisers, 7 Zoners, 7 Tricksters.
  - Every fighter has two distinct `MoveId`s (`specialMove` + `altSpecialMove`, 74 distinct special moves total), unique passive trait (`traitName` / `traitDesc`), custom `sfxPitch`, friendly Compass engineering/AI/data win quote, Battlemon companion (covering all 35 creatures in `datamonCatalog.js`), and bespoke physics/offense/defense/cancel modifiers.
- R3. Dynamic office background walkers (`art/stages.json`, `src/render/stage.ts`, `src/scenes/fight.ts`):
  - `art/stages.json` builds a diverse 9-coworker walker cast (`exclude: []`, `every: 4`, `count: 9`) so at least 7 coworkers remain available for any 2-fighter matchup.
  - `drawStage(ctx, camera, activeFighters?)` dynamically hides/skips any walker whose `slug` matches either active fighter in the ring (`state.fighters[0].slug` or `state.fighters[1].slug`), so nobody ever walks in the background of their own fight.
- R4. Full CPU, VFX, SFX & test coverage (`src/ai/cpu.ts`, `src/render/effects.ts`, `src/audio/sfx.ts`, `src/data/fighters.test.ts`, `src/sim/expansion.test.ts`, `src/render/shippedArt.test.ts`, `art/pipeline/tests/test_shipped_art.py`):
  - `createCpu` maps reach and tactical roles for all 82 `MoveId`s (8 shared normals/throw + 74 specials).
  - `EffectsLayer` and `sfx.ts` handle trails, arcs, dust, and audio cues for every new special.
  - Automated tests verify 37/37 manifests, boxes, camera margins, 74 specials, sim purity, 2400-frame determinism, and dynamic walker exclusion.

## Acceptance criteria
- [x] A1. (R1) All 37 fighters pass `art/pipeline/verify_fighter.py` and `pytest art/pipeline/tests`: 26 approved clips each, <= 48 palette colors, WebP visible mismatch 0, `ax <= 80px`, derived hurtboxes on every frame, and `public/fighters/index.json` + `src/data/boxes/index.ts` list all 37 slugs.
- [x] A2. (R2, R4) Vitest verifies all 37 `FIGHTERS` entries, 74 distinct specials (`Special` + `Forward + Special`), all 35 Battlemon slugs represented, frame bounds within each fighter's manifest, CPU tactics across the 37-fighter roster, and seeded determinism.
- [x] A3. (R3, R4) Dynamic walker filtering ensures active fighters never render as background walkers during their own match, and `./dm check` exits 0 (`typecheck`, `test`, `build`).

## Out of scope
- Full Battlemon super meter summons (spec 007) and additional stages beyond `office`.

## Decisions
- Dynamic runtime walker filtering replaces static `walkers.exclude` now that 100% of the 37-person catalog is playable.

## Open questions
- None.

## Tasks
- [x] T1. Author spec 017 and add 25 custom 8-pose `special` definitions to `art/clips.json`.
- [x] T2. Run Art Batch A (8 fighters: `andrea-vreugdenhil` .. `guillaume-delmas-frenette`) in parallel via Gemini Hydrogen.
- [x] T3. Run Art Batch B (8 fighters: `guillaume-pregent` .. `oyku-cildir`) in parallel via Gemini Hydrogen.
- [x] T4. Run Art Batch C (9 fighters: `philippe-miranda-jean` .. `william-chan`) in parallel via Gemini Hydrogen.
- [x] T5. Sync 37-fighter indexes, implement 74 specials + 37 fighter profiles + CPU/VFX/SFX + dynamic walkers, and verify end-to-end (`verify_fighter.py` x37, `pytest`, `./dm check`).

## Implementation notes
- **Art pipeline (25 new fighters -> `37 / 37` complete roster)**:
  - Rolling 8-slot Gemini Hydrogen parallel pipeline built complete 26-clip / 142-frame lossless WebP atlases, `palette-alt.json` mirror recolors, `manifest.json`, and `src/data/boxes/<slug>.json` for all 25 remaining colleagues (`676` OpenAI `gpt-image-2.5-sunburst` strips across Batches A/B/C; anchor overrides automatically generated for `milen-thomas` `throw[4]` and `tabarek-al-khalidi` `special[6]` so all `5,254` frames across the 37 manifests satisfy `ax <= 80px`).
  - Synced `public/fighters/index.json` (`37` entries) and `src/data/boxes/index.ts` (`37` imports).
- **74 unique specials & 37 fighter profiles (`src/data/moves.ts`, `src/data/fighters.ts`)**:
  - Balanced archetype split across all 37 fighters: `8` All-rounders, `8` Rushers, `7` Bruisers, `7` Zoners, `7` Tricksters.
  - Added 50 new `MoveDef`s (`82` total `MoveId`s, `74` distinct specials), representing all `35` Battlemon creatures in `datamonCatalog.js`, custom `sfxPitch`, friendly Compass work win quotes, and per-fighter integer physics/cancel/defense modifiers.
- **Dynamic office walkers, CPU AI & VFX (`art/stages.json`, `src/render/stage.ts`, `src/scenes/fight.ts`, `src/ai/cpu.ts`, `src/render/effects.ts`)**:
  - Rebuilt `office` walker strip with `9` coworkers (`exclude: []`, `every: 4`, `count: 9`), and added `resolveWalkerCastIndex` in `src/render/stage.ts` wired from `FightScene.render` so neither active combatant ever walks behind their own match.
  - Mapped all `82` moves in `src/ai/cpu.ts` (`REACH` + role tactics) and `src/render/effects.ts` (streaks, uppercut arcs, dust).
- **Verification**:
  - `art/pipeline/verify_fighter.py` across all 37 slugs: `PASS` (`37 / 37`, exit `0`).
  - `uv run --with pytest --with pillow --with numpy --with scipy pytest art/pipeline/tests -q`: `92 passed` (`2.89s`, exit `0`).
  - `./dm check`: `PASS typecheck` (`0.4s`), `PASS test` (`31` test files, `510 / 510` tests passed, `1.7s`), `PASS build` (`dist/assets/index-*.js` `157.23 kB` gzip, `0.5s`), exit `0`.

### Later changes (after this spec was built)
- **Mirror-match colors (`872724c`, merge with the release QA fixes).** The per-fighter `palette-alt.json` hue shift named in R1 and above is gone. Every one of the 37 fighters now has `art/fighters/<slug>/alt.json`, a `head-mask.png` and an offline-recolored `atlas-alt.webp` (QA F1, `art/pipeline/palette_alt.py`, see "Animation clip format" in `docs/game-design.md`), so a mirror match changes one or two garments and never a face or hair.
- **Live.** Deployed with the new default keys (`1985208`). The live `fighters/index.json` lists all 37 fighters.
- **Checks on `1985208`:** `./dm check` exit 0 (522 tests in 31 files); `uv run --with pytest --with pillow --with numpy --with scipy pytest art/pipeline/tests -q` exit 0, 352 passed.

## Review
(filled by spec-review)
