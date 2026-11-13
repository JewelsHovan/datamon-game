# 013: Load speed and memory

Status: review
Created: 2026-11-12

## Goal
The game opens and gets into a fight fast on an ordinary connection, and runs light: small downloads, a small memory footprint, a quiet CPU. Budgets are measured against a production build by a script, so a regression shows up as a failing check.

## Context
Release readiness, part 1 of 3 (the user: "ready like a published release ... responsive and optimized for speed and memory and CPU"; parts 2 and 3 are specs 014 and 015). Baseline measured 2026-11-12 on a production build (`vite build` + `vite preview`), headless Chrome, 10 Mbit/s down with 40 ms RTT and the cache disabled, with `specs/evidence/013/perf-check.mjs`:

| | Baseline |
|---|---|
| Title screen | 0.39 s, 80 KB |
| Straight into a CPU fight | 2.5 s to the first sim frame, 4.8 MB settled |
| Fight, 20 s, Hard CPU | main thread busy 2.3%, frame p95 16.8 ms, 0 frames over 20 ms, JS heap 3.3 MB |
| Images and canvases the page holds | select 26.5 MB, fight 31 MB (of which 12 MB is seven full walk sheets decoded for the stage walkers) |

The download is dominated by the fighter atlases (PNG, about 1.1 MB each) and the stage walkers, which decode 440x960 walk sheets to draw 84 px coworkers. Lossless WebP makes the atlases about 70% smaller with every visible pixel identical (checked: Julien 1033 KB to 317 KB, Pentcho 1169 KB to 330 KB, effects 324 KB to 223 KB, stage far 235 KB to 85 KB, mid 147 KB to 42 KB). CPU is already low; this spec keeps it there.

## Requirements
- R1. Shipped art is lossless WebP: each fighter atlas, the effects atlas and the stage layers. The art pipeline writes them (PNG masters stay under `art/` for review), manifests name the files, and loaders read the names from the manifests (or one shared constant), not hard-coded `.png`. Every visible pixel matches the PNG master.
- R2. Stage walkers use small sprite strips made by the pipeline: the four right-facing walk frames of each cast member at walker scale, in one strip per stage cast (`public/stages/office/walkers.webp` plus a manifest). The stage no longer fetches or decodes full walk sheets.
- R3. Load budgets on a production build (10 Mbit/s, 40 ms RTT, cache disabled): title screen within 1.0 s; straight into a CPU fight, first sim frame within 1.2 s; the fight's settled download at most 1.6 MB.
- R4. Runtime budgets in a 20 s Hard CPU fight: main thread busy at most 10%; frame p95 at most 17.5 ms and at most 1% of frames over 20 ms; JS heap at most 10 MB; images and canvases held by the page at most 24 MB in a fight started from the URL (the baseline 31 MB includes 12 MB of walk sheets). After 60 s, the JS heap has grown by at most 1 MB.
- R5. Repeat visits: `public/_headers` (Cloudflare Workers static assets) gives hashed build assets (`/assets/*`) a one-year immutable cache and the art (`/fighters/*`, `/effects/*`, `/stages/*`, `/datamon/*`) a short cache with revalidation, so a deploy is picked up without a stale-art window longer than an hour.
- R6. One command checks all budgets: `specs/evidence/013/perf-check.mjs` takes a URL of a production build and exits non-zero when a budget is missed.

## Acceptance criteria
- [x] A1. (R1) pytest: every shipped atlas and stage layer is WebP and its visible pixels equal the PNG master; manifests name the WebP files. `uv run --with pytest --with pillow --with numpy --with scipy pytest art/pipeline/tests -q` exits 0.
- [x] A2. (R1, R2) Vitest and a network log: a fight loads no `.png` art and no `datamon/walk/*` sheet (the browser check lists every request), and the walkers still draw (screenshot in `specs/evidence/013/`).
- [x] A3. (R3, R4, R6) `node specs/evidence/013/perf-check.mjs <preview URL> specs/evidence/013` exits 0 against a production build; `perf.json` holds the numbers and the spec notes compare them with the baseline above.
- [x] A4. (R5) `public/_headers` exists with the rules above, the build copies it to `dist/`, and a test checks its rules parse and cover `/assets/*` and the art folders.
- [x] A5. No regression: `./dm check` exits 0 and the 001, 003, 005, 008, 009 and 012 browser checks pass.

## Out of scope
- Rewriting the renderer (WebGL, OffscreenCanvas, workers): the CPU is already low.
- Image formats beyond WebP (AVIF) and responsive image sizes.
- Service workers and offline play (spec 014 covers installability, not offline).
- Releasing cached fighter atlases after the select screen (four fighters cost about 25 MB decoded; it matters once spec 011 adds the other 33).

## Decisions
- Lossless WebP over PNG: 70% smaller, pixel-identical, supported by every current browser (Safari 14+).
- Memory is measured as what the page holds (decoded images and canvases, counted in the page) plus the JS heap. The renderer's process footprint also includes Chrome's discardable image cache and varies by machine, so it is recorded but not budgeted.
- Budgets sit above the measured values with headroom, so normal noise in headless Chrome does not fail the check.

## Open questions
- None.

## Tasks
- [x] T1. Pipeline: `art/pipeline/pack.py`, `effects.py` and `stage.py` write lossless WebP next to the masters; manifests name the files; regenerate the shipped assets; pytest for A1.
- [x] T2. Loaders: `src/render/clips.ts` (atlas file from the manifest), `src/render/effects.ts`, `src/render/stage.ts` (layer files from the manifest); vitest.
- [x] T3. Walker strips: a pipeline step that cuts each cast member's right-facing walk frames at walker scale into `public/stages/office/walkers.webp` with a manifest; `src/render/stage.ts` draws from it.
- [x] T4. `public/_headers` and its test.
- [x] T5. Budgets in `specs/evidence/013/perf-check.mjs` (load, runtime, page-held images and canvases, request log); run it on a production build; evidence and notes.
- [x] T6. (Added during tackle: QA 2026-11-12 finding F3, 40 manifest 404s per load.) The pipeline writes `public/fighters/index.json` (every fighter with a manifest); `detectPlayable` (`src/scenes/roster.ts`) and `loadClipSetUncached` (`src/render/clips.ts`) read it once instead of probing a manifest per person; perf-check fails on any 404 in the title, select and fight loads; vitest and pytest.
- [x] T7. (Added during tackle: after T1 to T3 the fight from the URL measured 1.31 s, and 1.14 s with T6, against the 1.2 s budget.) A fight from the URL starts loading its art at boot, during the font wait, instead of after it (`src/scenes/game.ts`).

## Implementation notes

### What changed
- **Masters and shipped art (R1).** The PNG atlases and stage layers moved from `public/` to `art/` (`art/fighters/<slug>/atlas.png`, `art/effects/atlas.png`, `art/stages/office/{far,mid,walkers}.png`; `git mv`, same blobs). `public/` now holds only lossless WebP written by `common.save_webp` (`lossless=True, quality=100, method=6, exact=False`). `pack.py` and `effects.py pack` write master plus WebP and put `"atlas": "atlas.webp"` in the manifest; `stage.py manifest` exports every layer from its master and names the `.webp` files. `boxes.py` reads the master. `art/pipeline/ship.py` re-exports everything from the masters without generation or repacking (that is how the shipped files were regenerated; re-running it changes nothing). Sizes: Julien 1034 to 318 KB, Felicia 1091 to 311, Pentcho 1170 to 330, Alex 1149 to 313, effects 325 to 224, far 241 to 87, mid 151 to 43.
- **Loaders.** `parseManifest` reads `atlas` (a plain file name; `atlas.webp` when absent), and `artUrl(dir, file, version)` builds every art URL as `<file>?v=<manifest version>`: art is cached for up to an hour (R5), and the version keeps a fresh manifest from pairing with an older cached atlas. `loadEffects` and `loadStageArt` (new, `src/render/stage.ts`) read file names from their manifests. The stage manifest now has a `version` that moves only when its content changes.
- **Walker strip (R2).** `art/stages.json` holds the cast rule (`walkers`: exclude the four launch fighters, every fifth person, at most seven, 60% of a 150 px standing person). `stage.py manifest` applies it, cuts each cast member's four right-facing walk frames at that scale (area average, hard alpha, trimmed, anchor on the feet), packs them into `public/stages/office/walkers.webp` (988x87, 68 KB) and writes the cast and frames into the stage manifest. `stage.ts` draws from the manifest only (no catalog lookup, no `loadClipSet`), one darkened copy of the strip, drawn 1:1 after the furniture and before the dimming pass; walking cycles the four frames, a K.O. shows the standing frame facing the fight. `stageInfo()` is unchanged.
- **Cache rules (R5).** `public/_headers`: `/assets/*` gets `public, max-age=31536000, immutable`; `/fighters/*`, `/effects/*`, `/stages/*`, `/datamon/*` get `public, max-age=3600, must-revalidate`. No overlapping patterns (Cloudflare joins the values of rules that match one path). The page itself keeps Cloudflare's default (`max-age=0, must-revalidate`). No Worker script and no `wrangler.jsonc` change; `fighters/<slug>/manifest.json` keeps its path, so the `./dm deploy` smoke test is unaffected.
- **Fighter index (T6, QA F3).** `public/fighters/index.json` (written by `common.write_fighter_index`, called from `pack.py` and `ship.py`) lists every fighter with a manifest. `loadFighterIndex` fetches it once per loader (`browserClipDeps()` is now one shared object); `detectPlayable` takes the playable set from it, and `loadClipSetUncached` skips the manifest request for anyone it does not list. Without an index (an older build) both fall back to the old probe. The select screen still lets only fighters with manifests be picked (005 check, "coming soon cannot be picked").
- **Boot order (T7).** For a fight from the URL, `startGame` starts the fight's art (`loadFightAssets`) before awaiting the font; the versus scene picks up the same promise. Waterfall: the atlases now start at 0.19 to 0.24 s instead of 0.32 s, and the font no longer sits on the critical path.
- **Harness (R6).** `perf-check.mjs` now fails on any budget miss and writes `perf.json`, `requests.json` (every request with phase, status, size and start/end ms) and `results.json`. Times run from the navigation request (the baseline timed from after `Page.navigate` returned, roughly one round trip later), so the new numbers are slightly conservative. The page-held inventory (images and canvases wrapped before the page's scripts run) also counts canvases that are in the HTML, so it includes the 0.9 MB `#game` canvas the baseline did not. JS heap growth is measured on retained heap after a forced GC at 0 s and 60 s into the fight.

### Acceptance evidence
- **A1.** `uv run --with pytest --with pillow --with numpy --with scipy pytest art/pipeline/tests -q` exit 0, 29 passed. `art/pipeline/tests/test_shipped_art.py`: each fighter atlas, the effects atlas, both stage layers and the walker strip are WebP, named by their manifest, and `visible_mismatch` against the PNG master is 0 (any alpha difference, or a color difference where the master's alpha > 0); no `.png` under `public/fighters`, `public/effects`, `public/stages`; the WebP writer keeps visible pixels on a random image with junk color under alpha 0; the walker cast follows the rule; the index matches the manifests.
- **A2.** Vitest `src/render/shippedArt.test.ts` (in `./dm check`): loading both fighters, a mirror match's recolor, the effects and the stage from the real `public/` manifests requests only `*.webp?v=N` images, no `.png`, no `datamon/walk/`. Network log from the production build (`specs/evidence/013/requests.json`, `results.json`): the fight phase made 17 requests, none `.png` art, none `datamon/walk/*`. Walkers draw: `specs/evidence/013/fight-walkers.png` (perf-check, production build), and the refreshed 009 shots `specs/evidence/009/04-walkers-walking.png` and `05-walkers-watch-ko.png` (walkers look and sit as before, and stop and face the fight on the K.O.).
- **A3.** `node specs/evidence/013/perf-check.mjs http://127.0.0.1:56556/ specs/evidence/013` against `vite build` + `vite preview` exit 0, 17 of 17 records pass. Numbers (`specs/evidence/013/perf.json`) next to the baseline:

  | | Baseline | Now | Budget |
  |---|---|---|---|
  | Title screen | 0.39 s, 80 KB, 42 requests | 0.31 s, 66 KB, 6 requests | 1.0 s |
  | Select step (S, F, 3 s) | 2204 KB | 708 KB | not budgeted |
  | Fight from the URL: first sim frame | 2.5 s | 0.98 s | 1.2 s |
  | Fight: settled download | 4.8 MB, 66 requests | 1144 KB, 17 requests | 1.6 MB |
  | Fight, 20 s Hard CPU: main thread busy | 2.3% | 2.2% | 10% |
  | Frame p95, frames over 20 ms | 16.8 ms, 0 | 16.8 ms, 0 of 1200 | 17.5 ms, 1% |
  | JS heap | 3.3 MB | 3.7 MB | 10 MB |
  | JS heap growth over 60 s | not measured | +0.39 MB retained (2.60 to 2.99) | 1 MB |
  | Images and canvases the page holds, fight | 31 MB (12 MB walk sheets) | 19.0 MB (17.7 images, 1.3 canvases incl. the 0.9 MB `#game`) | 24 MB |
  | Renderer RSS, fight / 60 s later | 477 / 462 MB | 787 / 437 MB | recorded only |

  The fight's 19 MB: the two fighter atlases 12.6 MB decoded, effects 2.1, stage layers 2.7, walker strip 0.33 plus its darkened copy 0.33. Renderer RSS right after the select screen includes memory Chrome had not released yet; 60 s later it is below the baseline (Decisions: recorded, not budgeted). Earlier runs on the same build: first sim frame 0.99 s, title 0.45 s; before T7 1.14 s, before T6 1.31 s.
- **A4.** `public/_headers` as above. `npx vite build --outDir <tmp>/dist --emptyOutDir` exit 0, then `cmp public/_headers <tmp>/dist/_headers` exit 0, and the build holds no `.png`. Vitest `src/deployHeaders.test.ts` (8 tests) parses the file in Cloudflare's format and checks `/assets/*` (one year, immutable), each art folder (one Cache-Control, at most an hour, `must-revalidate`, not immutable) and that the page has no rule. A mutation run (an overlapping `/*` rule appended) made it exit 1.
- **A5.** `./dm check` exit 0 (typecheck, 25 test files and 318 tests, build). Browser checks against `./dm dev` on this worktree: 001 browser-check exit 0 (the first run exited 1 on A10 because I edited `vite.config.ts` mid-run and Vite reloaded the page; the rerun with nothing touched passed 13/13), 003 fight-check exit 0, 005 flow-check exit 0, 008 cpu-check exit 0, 009 stage-check exit 0 (output into `specs/evidence/009`, walker shots refreshed), 012 moves-check exit 0. `uv run --with pillow python -I hq/build_hq.py` exit 0 (the HQ reads walk sheets and portraits, not atlases).
- **No new 404s (QA F3, T6).** The perf-check request log records every response status per phase and fails on any 4xx or 5xx: title 6 requests, select 42, fight 17, none failed. The only 404 is `/favicon.ico` (title and select), which predates this spec and is spec 014's R1; perf-check reports it separately as known instead of hiding it. Before: 33 manifest 404s at boot plus 7 more from the walker cast.

### Follow-ups
- Spec 014 adds the favicon; then drop `/favicon.ico` from `KNOWN_404` in `perf-check.mjs`.
- The fight load is now bandwidth-bound: about 870 KB of atlases (two fighters plus effects) at 10 Mbit/s. If a future budget needs more, loading the effects atlas after the fight starts would save about 0.18 s (out of scope here: it changes when `EffectsLayer` gets its atlas).
- `loadAltClipSet` still requests `palette-alt.json` without checking the index; every packed fighter has one today, so no 404, but a new fighter without one would 404 in a mirror match.
- Out of scope per the spec: releasing cached fighter atlases after the select screen (matters once spec 011 adds the other 33).

## Review
(filled by spec-review)
