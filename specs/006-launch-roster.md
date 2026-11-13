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

### QA run 2026-11-12 20:13 (release), F1: alternate palettes
The run found Pentcho's mirror-match colors blotchy: his hair and beard share exact browns with his jacket, so the exact-color map (`palette-alt.json`, applied at load by `remapColors`) put blue patches in his hair and beard and left other jacket browns brown. Julien's trousers had red specks: a near-neutral trouser shade sat in the sweater's map and was tinted red. The rule now: the alternate colors never change a pixel of a face, hair, beard or skin, and the garment they recolor changes completely.

- **Option (b), recolor offline.** `art/pipeline/palette_alt.py` recolors per pixel and ships `public/fighters/<slug>/atlas-alt.webp` (lossless, 301 to 342 KB), named by the manifest as `atlasAlt`. `loadAltClipSet` (`src/render/clips.ts`) loads that atlas instead of fetching a map and recoloring a canvas; `remapColors`, `altPaletteUrl` and the four `palette-alt.json` files are gone. Chosen over (a) because the hurt boxes cannot find a head: `boxes.py` makes the first box from the top 24% of each frame's rows, which is the feet in `air_hurt` 2 and `getup_roll` 1 and 2, the whole lying body in `knockdown` 2 and 4 and `air_hurt` 3, and in upright frames a full-width band that also covers the raised fists, collar and shoulders (a protected rectangle would leave those jacket pixels brown). A per-pixel head mask is needed either way, and with it doing the work offline means the pytest checks exactly the pixels the game draws, there is no 7 MB `getImageData` readback on a phone, and the runtime is just a second image. The cost is the second atlas in a mirror match, which then downloads the same as any match of two different fighters (Julien 325 + 317 KB against Julien + Pentcho 325 + 338 KB); spec 013's perf-check still passes (below).
- **Head masks** (`art/pipeline/heads.py`). A reference head, a polygon drawn once per fighter on `idle` 0 in `art/fighters/<slug>/alt.json`, is searched in every frame over 36 rotations and all positions (sum of squared color and silhouette differences, FFT), placed, clipped to the frame and grown 2 px near the silhouette, then grown 2 px more through the reference head's own colors (hair at the back of the head reaching past the placed shape). Every frame of all four fighters (569) was reviewed by eye with the mask tinted. Overrides in `alt.json`: head polygons where the head hides behind a guard or an arm or the match lands elsewhere (Pentcho `block` 1, `crouch_hurt` 1, `jump` 1, `special` 5; Julien `block` 1, `jump` 1, `getup_roll` 1; Alex `jump` 1, `air_hurt` 2), and cut-outs where a punching arm passes right under Pentcho's chin (`light_punch` 3, `heavy_punch` 5, `throw` 4 and 5). The masks are saved as `art/fighters/<slug>/head-mask.png`.
- **Garments** (`alt.json`). Each garment has a full color map and a `shared` list: colors it shares with something that must not change (Pentcho's browns in his shoes and belt, Julien's charcoal in his shirt collar). Unshared colors (anchors) always change outside the heads; a shared color takes the side most of its decided neighbors (radius 4) are on, pass after pass, so it spreads through the jacket and stops at the shoes. Garments marked `headFree` (every fighter but Pentcho) have no color any head has, checked against the reference head, so a sleeve inside a generous head mask still changes; their `inHead` colors (Julien's eye greens, Felicia's eye greys) never change inside a head. The maps: Pentcho's blazer, all 24 jacket browns (hue +190, x1.6 saturation, x1.15 value; the old 7 entries kept their colors), shirt, trousers and shoes now unchanged; Julien's sweater (13 greens, maroon) and trousers (12 charcoals, green, one rotation of 225 degrees as before, plus the two big trouser shades the old map missed); Felicia and Alex keep their old colors and gain the few shades the old map missed (Felicia's six greys, Alex's four blues), which removes the grey and blue specks they had. Near-black outline entries were dropped (no visible change).
- **Proof.** `art/pipeline/tests/test_alt_palette.py` (in `uv run --with pytest --with pillow --with numpy --with scipy pytest art/pipeline/tests -q`, EXIT=0, 88 passed): every manifest names `atlas-alt.webp` and it equals its PNG master; same size and alpha as the atlas; no pixel inside a head mask changes (outside the `headFree` colors) and those colors are absent from the reference heads; every frame has a head of at least 150 px; skin colors and colors outside the maps never change; every change is one of its garment's map pairs. Measured: every anchor-color pixel outside the heads changed (Pentcho 110 856, Julien 307 267, Felicia 265 042, Alex 182 703, all 1.0000); specks (a garment-colored pixel whose fate differs from at least 6 of its 8 neighbors) Pentcho 272 of 254 868 (0.11%), Julien 230 of 382 446 (0.06%), Felicia 166 of 317 978 (0.05%), Alex 1 of 194 077, against 8 572, 4 734, 8 089 and 2 099 with the old maps by the same rule; in the torso hurt box of every upright frame, the garment-colored pixels that changed: Alex 99.4%, Felicia 98.4%, Pentcho 91.7%, Julien 90.1% (the rest share the garment's colors but are not the garment: Pentcho's hands, belt and lapel shadow line, Julien's collar and the near-black outline of his sweater).
- **Contact sheet** `specs/evidence/006/alt-palettes.png` (`palette_alt.py --sheet`), looked at: all four fighters, normal next to alt at 2x, four frames each of idle, walk, hurt, knockdown, air_hurt, special and victory. Pentcho wears a uniformly blue blazer in every pose, lying and upside down included, with his hair, beard, glasses, face and hands as before, a white shirt, dark trousers and brown shoes and belt. Julien wears a maroon sweater and green trousers with no red specks; his hair, face and green eyes are unchanged. Felicia (navy top, light blue jeans) and Alex (mustard shirt) look as before, without the leftover grey and blue specks.
- **Pipeline.** `pack.py` reminds to re-run `palette_alt.py` (a repack drops `atlasAlt`); `ship.py` re-exports `atlas-alt.webp` from its master; new alternate pixels bump the manifest version (the art's cache key). `docs/game-design.md` describes `atlasAlt`.
- **Runtime and budgets.** `src/render/clips.test.ts` has five new tests (the alternate atlas loads from the manifest with the version query and no canvas readback; none named, no request; another size is ignored with a warning; a blocked one fails the load like the main atlas; `atlasAlt` must be a file name), and `src/render/shippedArt.test.ts` now expects a mirror match to request `atlas-alt.webp` and no `palette-alt.json`. `./dm check` EXIT=0. Spec 013's `perf-check.mjs` against a production build (`npx vite build` into a scratch directory, `npx vite preview` on port 60979, stopped afterwards) EXIT=0, all budgets met: title 409 ms (budget 1000), fight first sim frame 972 ms (1200), fight settled download 1161 KB (1600), main thread 2.6% (10), frame p95 16.8 ms (17.5), JS heap 3.4 MB (10), images and canvases held 19 MB (24), heap growth over 60 s 0.4 MB (1), no .png art, no 404s. Its fight is Julien against Pentcho; a mirror match downloads Julien's atlas and his alternate one (325 + 317 KB), 21 KB less than that pair (325 + 338 KB), and holds one decoded image where the old recolor held a canvas of the same size. In the browser checks' mirror matches (spec 003's fight-check, spec 015's 1024x768 fight) P2 Julien (ALT) draws in maroon and green with his face and hair unchanged.

## Review
(filled by spec-review)
