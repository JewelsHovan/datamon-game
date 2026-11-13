# 013: Load speed and memory

Status: in-progress
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
- [ ] A1. (R1) pytest: every shipped atlas and stage layer is WebP and its visible pixels equal the PNG master; manifests name the WebP files. `uv run --with pytest --with pillow --with numpy --with scipy pytest art/pipeline/tests -q` exits 0.
- [ ] A2. (R1, R2) Vitest and a network log: a fight loads no `.png` art and no `datamon/walk/*` sheet (the browser check lists every request), and the walkers still draw (screenshot in `specs/evidence/013/`).
- [ ] A3. (R3, R4, R6) `node specs/evidence/013/perf-check.mjs <preview URL> specs/evidence/013` exits 0 against a production build; `perf.json` holds the numbers and the spec notes compare them with the baseline above.
- [ ] A4. (R5) `public/_headers` exists with the rules above, the build copies it to `dist/`, and a test checks its rules parse and cover `/assets/*` and the art folders.
- [ ] A5. No regression: `./dm check` exits 0 and the 001, 003, 005, 008, 009 and 012 browser checks pass.

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
- [ ] T4. `public/_headers` and its test.
- [ ] T5. Budgets in `specs/evidence/013/perf-check.mjs` (load, runtime, page-held images and canvases, request log); run it on a production build; evidence and notes.

## Implementation notes
(filled by spec-tackle)

## Review
(filled by spec-review)
