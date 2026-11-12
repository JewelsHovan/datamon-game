# 002: Animation pipeline and Julien's full set

Status: ready
Created: 2026-11-12

## Goal
A repeatable pipeline turns image-generation output into game-ready animation clips, proven by Julien H.'s complete core set: 17 clips that play cleanly at game timing and load through the clip format the engine uses.

## Context
Round 2 of the interview made image-generated animation the quality centerpiece (`docs/game-design.md`, sections "Animation pipeline", "Core animation set" and "Animation clip format"; read them first, they are binding). The spike proved the approach on one heavy punch (`art/spike/`, raw images in `.claude-images/2026-11-12/`): identity holds across frames, the model's alpha halo needs a hard cut, frames overlap horizontally so cutting must use connected components, and back-foot anchoring keeps the punch planted.

Runs in parallel with spec 001. Nothing here touches `src/` except the preview page (T7), which reuses spec 001's `src/render/clips.ts` if it has landed, or a small standalone player if not.

## Requirements
- R1. Clip definitions: `art/clips.json` lists the 17 core clips with id, frame count, loop flag, default holds per frame, and one pose line per frame, matching the table in the design doc.
- R2. Generator: `art/pipeline/generate.py <slug> <clip> [--n K] [--dry-run] [--max-images M] [--force]` builds the prompt (shared style block plus the clip's pose lines), attaches references (walk-sheet front and side frames at 2x, plus the fighter's approved idle frame when one exists), calls the image-compass `generate_openai.py` (`gpt-image-2.5-sunburst`, transparent background, high quality, size by frame count), saves raw output to `art/raw/<slug>/<clip>/`, and appends one JSON line per image to `art/generation-log.jsonl`. `--dry-run` prints the prompt and command and spends nothing. It refuses to regenerate an approved clip without `--force`. The image-compass scripts directory comes from `IMAGE_COMPASS_SCRIPTS`, defaulting to the installed plugin path.
- R3. Processor: `art/pipeline/process.py <slug> <clip> <raw.png>` cuts frames (alpha below 128 dropped, connected components, small pieces joined to the nearest figure, left-to-right order), stops with a clear report when the frame count differs from the definition, scales with the fighter's single scale factor (set from the approved idle so the stance is 140px tall), downsamples by area averaging with hard alpha, locks colors to the fighter's palette (at most 48 colors), computes anchors (floor = lowest opaque row, x = back foot's rear edge) with overrides from `art/fighters/<slug>/anchors.json`, and writes `art/fighters/<slug>/<clip>/NN.png` plus a contact sheet and a timed GIF for review.
- R4. Packer: `art/pipeline/pack.py <slug>` packs every approved clip into `public/fighters/<slug>/atlas.png` and `manifest.json` in the binding format.
- R5. Review status: `art/fighters/<slug>/status.json` records each clip as generated, approved or rejected, with a note. Only approved clips are packed.
- R6. Preview page: a dev-only page (`preview.html`) plays any packed clip at 60 Hz with its holds, steps frame by frame, toggles onion skin, draws the floor line and the anchor, mirrors for facing left, and saves anchor nudges back to `anchors.json` through a Vite dev-server endpoint.
- R7. Julien's full set: all 17 clips generated, processed, reviewed, approved and packed, with the preview GIFs published to the HQ for the user to see.

## Acceptance criteria
- [ ] A1. (R1) `art/clips.json` has 17 clips whose ids and frame counts match the design doc table; a pytest checks it. How to check: `uv run --with pytest --with pillow --with numpy --with scipy pytest art/pipeline/tests` exit 0.
- [ ] A2. (R2) `generate.py julien-hovan heavy_punch --dry-run` prints a prompt that contains all 6 pose lines and names both reference files, exits 0, and adds nothing to `art/generation-log.jsonl`. How to check: run it, compare the log's line count before and after.
- [ ] A3. (R3) Processor tests on a committed fixture (the spike punch strip, downscaled 50%): finds exactly 6 frames in left-to-right order; every output frame's anchor sits on its bottom opaque row; a definition expecting 4 frames fails with a non-zero exit and a message naming both counts. How to check: pytest as in A1.
- [ ] A4. (R3) Every processed frame of Julien's set uses at most 48 colors, all from `art/fighters/julien-hovan/palette.json`, and the idle stance frames are 140±3px tall. How to check: a pytest over `art/fighters/julien-hovan/`.
- [ ] A5. (R4) `manifest.json` validates against the design-doc format (a pytest with a schema), lists all 17 clips, every frame rectangle lies inside the atlas, and the atlas is at most 2048x2048. How to check: pytest.
- [ ] A6. (R6) In the browser the preview page plays each of the 17 clips, mirrors one correctly, and an anchor nudge changes `anchors.json` on disk. How to check: browser tools, a screenshot of a clip mid-play, `git diff` of `anchors.json`.
- [ ] A7. (R7) Visual bar for every clip: same person in every frame, no missing or extra limbs, faces right, planted feet do not slide more than 2px between frames of idle and attacks, and the motion reads at game timing. How to check: per-clip contact sheet and GIF, reviewed frame by frame, findings in Implementation notes; frames that fail are regenerated or fixed.
- [ ] A8. (R7) All 17 clips are `approved` in `status.json`, the user has seen them on the HQ, and the generation log records every image generated (total in Implementation notes). How to check: read `status.json`, count log lines.

## Out of scope
- Hitboxes, hurtboxes and move frame data (spec 003). The preview page may grow a box editor there.
- Effect animations and stages (specs 004 and 009); they reuse this pipeline later.
- The other launch fighters (spec 006).
- Wiring clips into the fight scene's state machine (spec 003).

## Decisions
- Raw generations are gitignored (`art/raw/`, `.claude-images/`); processed frames, palettes, anchors, status, the generation log and packed atlases are committed.
- Generate idle first and approve it before any other clip, so its frame becomes a reference and sets the fighter's scale.
- Strip sizes: 3072x1024 for 5 to 8 frames, 2048x1024 for up to 4 frames. Never more than 8 frames per strip.
- One retry budget per clip: up to 3 generations before raising it with the user.
- Palette lock uses k-means on the walk sheet plus the approved idle, at most 48 colors, nearest-color mapping without dithering.
- Python through uv: `uv run --with pillow --with numpy --with scipy`. No project venv needed.

## Open questions
- None.

## Tasks
- [ ] T1. `art/clips.json` with the 17 clip definitions and pose lines.
- [ ] T2. `art/pipeline/generate.py` (prompt builder, reference prep, subprocess call to image-compass, raw save, log, dry-run, max-images, force).
- [ ] T3. `art/pipeline/process.py` (cut, count check, scale, downsample, palette lock, anchors, contact sheet, GIF) and `art/pipeline/palette.py`.
- [ ] T4. `art/pipeline/pack.py` (shelf packing, manifest writer).
- [ ] T5. Tests and fixture: `art/pipeline/tests/` with the downscaled spike strip.
- [ ] T6. Generate and approve Julien's idle; set his scale and palette.
- [ ] T7. Preview page `preview.html` + `src/preview/` and the Vite dev endpoint for anchors.
- [ ] T8. Generate, process and review the other 16 clips; regenerate failures.
- [ ] T9. Pack, publish the review GIFs to the HQ, record totals.

## Implementation notes
(filled by spec-tackle)

## Review
(filled by spec-review)
